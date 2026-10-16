import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { detectPlatform } from './pwa'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

type Icon = { src: string; sizes: string; type: string; purpose?: string }
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: Icon[]
  shortcuts: { name: string; url: string; icons: Icon[] }[]
}

function pngSize(file: string): [number, number] {
  const buf = readFileSync(path.join(root, 'public', file))
  expect(buf.subarray(1, 4).toString()).toBe('PNG')
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

describe('web app manifest', () => {
  it('is installable: name, standalone, scope and start URL', () => {
    expect(manifest.name).toBe('Pocket Goblin')
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url.startsWith('/')).toBe(true)
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('has 192 and 512 icons, including maskable, at their real sizes', () => {
    for (const size of ['192x192', '512x512']) {
      expect(
        manifest.icons.some(
          (i) => i.sizes === size && i.purpose !== 'maskable',
        ),
      ).toBe(true)
      expect(
        manifest.icons.some(
          (i) => i.sizes === size && i.purpose === 'maskable',
        ),
      ).toBe(true)
    }
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(icon.src)
      expect(`${w}x${h}`).toBe(icon.sizes)
    }
    expect(pngSize('/icons/apple-touch-icon.png')).toEqual([180, 180])
  })

  it('has a Talk to Goblin shortcut that opens the voice screen', () => {
    const talk = manifest.shortcuts.find((s) => s.name === 'Talk to Goblin')
    expect(talk?.url).toMatch(/^\/voice\?listen=1/)
    for (const s of manifest.shortcuts) {
      expect(s.url.startsWith('/')).toBe(true)
      for (const icon of s.icons)
        expect(`${pngSize(icon.src).join('x')}`).toBe(icon.sizes)
    }
  })

  it('is linked from the page with a theme colour and iOS icon', () => {
    const html = read('index.html')
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('apple-touch-icon')
    expect(html).toContain('name="theme-color"')
  })
})

describe('service worker', () => {
  const sw = read('public/sw.js')
  it('never caches the API', () => {
    expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)\) return/)
  })
  it('precaches only shell files that exist', () => {
    const shell = sw.match(/const SHELL = \[([\s\S]*?)\]/)![1]!
    for (const entry of shell.match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))) {
      if (entry === '/') continue
      expect(() => read(`public${entry}`), entry).not.toThrow()
    }
  })
  it('waits for the page before updating, and removes old caches', () => {
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'")
    expect(sw).not.toMatch(/install[\s\S]{0,200}skipWaiting\(\)/)
    expect(sw).toContain('caches.delete')
  })
  it('is served uncached so updates arrive', () => {
    expect(read('public/_headers')).toMatch(
      /\/sw\.js\n\s+Cache-Control: no-cache/,
    )
  })
})

describe('platform detection for install help', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      'ios-safari',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 CriOS/124.0 Mobile/15E148 Safari/604.1',
      'ios-other',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36',
      'samsung',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
      'android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'desktop-chromium',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15',
      'desktop-safari',
    ],
  ])('%s', (ua, platform) => {
    expect(detectPlatform(ua)).toBe(platform)
  })
})
