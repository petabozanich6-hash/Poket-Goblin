import { Brain, Home, ListTodo, LogOut, Sparkles, SunMoon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'

import { GoblinMascot } from '@/components/goblin/GoblinMascot'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { applyTheme } from '@/lib/theme'

import styles from './AppShell.module.css'

const links = [
  { to: '/den', label: 'Den', icon: Home, end: true },
  { to: '/capture', label: 'Dump', icon: Brain },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/plan', label: 'Plan', icon: Sparkles },
]

export function AppShell() {
  const { user, settings, logout, saveSettings } = useAuth()

  async function toggleTheme() {
    const current = settings?.theme ?? 'system'
    const next =
      current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
    applyTheme(next)
    await saveSettings({ theme: next })
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <GoblinMascot size={40} mood="happy" />
          <div>
            <p className={styles.brandName}>Pocket Goblin</p>
            <p className={styles.brandTag}>Your brain has enough tabs open.</p>
          </div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.userChip}>{user?.displayName}</span>
          <Button variant="ghost" size="sm" onClick={() => void toggleTheme()}>
            <SunMoon size={16} aria-hidden />
            Theme
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void logout()}>
            <LogOut size={16} aria-hidden />
            Log out
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Primary">
          {links.map((link) => {
            const Icon = link.icon
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  [styles.navLink, isActive ? styles.active : '']
                    .filter(Boolean)
                    .join(' ')
                }
              >
                <Icon size={18} aria-hidden />
                {link.label}
              </NavLink>
            )
          })}
        </nav>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
