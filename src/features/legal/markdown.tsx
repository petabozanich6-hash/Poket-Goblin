import { Fragment, type ReactNode } from 'react'

/**
 * A deliberately tiny Markdown renderer for our own policy documents:
 * headings, paragraphs, nested lists, block quotes, tables, **bold**,
 * `code` and links. It builds React elements (never raw HTML), so even a
 * stray "<" in a document can't become markup.
 */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(\S+@\S+\.\w+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], i)}</strong>)
    else if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>)
    else if (m[3] !== undefined && m[4] !== undefined) {
      const href = m[4]
      const safe = /^(https?:|mailto:|\/)/.test(href) ? href : undefined
      out.push(
        <a key={k} href={safe}>
          {m[3]}
        </a>,
      )
    } else if (m[5] !== undefined) {
      const email = m[5].replace(/[.,;:]+$/, '')
      out.push(
        <a key={k} href={`mailto:${email}`}>
          {email}
        </a>,
      )
      if (email.length < m[5].length) out.push(m[5].slice(email.length))
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type ListItem = { text: string; children: ListItem[] }

function parseList(lines: string[]): ListItem[] {
  const root: ListItem[] = []
  const stack: { indent: number; items: ListItem[] }[] = [
    { indent: -1, items: root },
  ]
  for (const line of lines) {
    const m = line.match(/^(\s*)- (.*)$/)
    if (!m) {
      // Continuation of the previous item.
      const items = stack[stack.length - 1]!.items
      const prev = items[items.length - 1]
      if (prev) prev.text += ` ${line.trim()}`
      continue
    }
    const indent = m[1]!.length
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent)
      stack.pop()
    const item: ListItem = { text: m[2]!, children: [] }
    stack[stack.length - 1]!.items.push(item)
    stack.push({ indent, items: item.children })
  }
  return root
}

function renderList(items: ListItem[], key: string): ReactNode {
  return (
    <ul key={key}>
      {items.map((item, i) => (
        <li key={i}>
          {inline(item.text)}
          {item.children.length
            ? renderList(item.children, `${key}-${i}`)
            : null}
        </li>
      ))}
    </ul>
  )
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split('\n')
        const first = lines[0] ?? ''
        const heading = first.match(/^(#{1,3}) (.*)$/)
        if (heading && lines.length === 1) {
          const level = heading[1]!.length
          const content = inline(heading[2]!)
          return level === 1 ? (
            <h1 key={b}>{content}</h1>
          ) : level === 2 ? (
            <h2 key={b}>{content}</h2>
          ) : (
            <h3 key={b}>{content}</h3>
          )
        }
        if (lines.every((l) => l.startsWith('>')))
          return (
            <blockquote key={b}>
              <p>
                {inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}
              </p>
            </blockquote>
          )
        if (/^\s*- /.test(first)) return renderList(parseList(lines), `l${b}`)
        if (first.startsWith('|')) {
          const rows = lines
            .filter((l) => !/^\|[\s:|-]+\|$/.test(l))
            .map((l) =>
              l
                .replace(/^\||\|$/g, '')
                .split('|')
                .map((cell) => cell.trim()),
            )
          const [head, ...body] = rows
          return (
            <div key={b} style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {head?.map((cell, i) => (
                      <th key={i} scope="col">
                        {inline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, i) => (
                        <td key={i}>{inline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p key={b}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i ? <br /> : null}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}
