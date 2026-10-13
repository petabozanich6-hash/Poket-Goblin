import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { searchAll } from '@/features/life/lifeApi'

import styles from './Page.module.css'

export function SearchPage() {
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q.trim())

  const searchQuery = useQuery({
    queryKey: ['search', deferred],
    queryFn: () => searchAll(deferred),
    enabled: deferred.length > 0,
  })

  const emptyQuery = useQuery({
    queryKey: ['search', ''],
    queryFn: () => searchAll(''),
    enabled: deferred.length === 0,
  })

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Find</h1>
          <p className={styles.sub}>
            Search across tasks, notes, appointments, shopping, documents,
            reminders and captures — without remembering which shelf you used.
          </p>
        </div>
      </header>

      <Card>
        <Input
          label="Search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="That electricity bill, dentist, things to buy…"
          autoFocus
        />
        {deferred && (searchQuery.data?.suggestions.length ?? 0) > 0 ? (
          <p className={styles.sub}>
            Related titles: {searchQuery.data?.suggestions.join(' · ')}
          </p>
        ) : null}
      </Card>

      {!deferred ? (
        <>
          <p className={styles.sub}>
            Start typing to search your goblin shelves. Results are real matches
            only — nothing invented.
          </p>
          {(emptyQuery.data?.recent?.length ?? 0) > 0 ? (
            <Card>
              <h2>Recent searches</h2>
              <ul className={styles.stack}>
                {emptyQuery.data?.recent?.map((query) => (
                  <li key={query}>
                    <button
                      type="button"
                      className={styles.tab}
                      onClick={() => setQ(query)}
                    >
                      {query}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : searchQuery.isLoading ? (
        <p className={styles.sub}>Searching…</p>
      ) : searchQuery.isError ? (
        <Card>
          <p className={styles.sub}>
            Search hiccuped. Your data is safe — try again in a moment.
          </p>
        </Card>
      ) : (searchQuery.data?.groups.length ?? 0) === 0 ? (
        <Card>
          <p className={styles.sub}>Nothing matched “{deferred}”.</p>
        </Card>
      ) : (
        (searchQuery.data?.groups ?? []).map((group) => (
          <Card key={group.type}>
            <h2>{group.label}</h2>
            <ul className={styles.stack}>
              {group.items.map((item) => (
                <li key={`${group.type}-${item.id}`} className={styles.listRow}>
                  <div>
                    <Link to={item.href}>{item.title}</Link>
                    <p className={styles.sub}>
                      {group.label}
                      {item.subtitle
                        ? ` · ${
                            group.type === 'event' &&
                            !Number.isNaN(Date.parse(item.subtitle))
                              ? new Date(item.subtitle).toLocaleString()
                              : item.subtitle
                          }`
                        : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
