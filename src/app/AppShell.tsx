import {
  Brain,
  CalendarDays,
  FileText,
  Home,
  Inbox,
  ListTodo,
  LogOut,
  Layers,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useEffect } from 'react'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { FloatingCapture } from '@/features/magical/FloatingCapture'
import { NudgeTray } from '@/features/magical/NudgeTray'
import { OverwhelmMode } from '@/features/magical/OverwhelmMode'
import { OverwhelmProvider } from '@/features/magical/OverwhelmContext'

import styles from './AppShell.module.css'

const primaryLinks = [
  { to: '/den', label: 'Den', icon: Home, end: true },
  { to: '/capture', label: 'Dump', icon: Brain },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/life', label: 'Life', icon: Layers },
  { to: '/plan', label: 'Plan', icon: Sparkles },
]

const secondaryLinks = [
  { to: '/find', label: 'Find', icon: Search },
  { to: '/ask', label: 'Ask', icon: MessageCircle },
  { to: '/vault', label: 'Vault', icon: FileText },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function NavItems({
  links,
  quiet = false,
}: {
  links: Array<{
    to: string
    label: string
    icon: typeof Home
    end?: boolean
  }>
  quiet?: boolean
}) {
  return (
    <>
      {links.map((link) => {
        const Icon = link.icon
        return (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              [
                styles.navLink,
                quiet ? styles.navQuiet : '',
                isActive ? styles.active : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
          >
            <Icon size={18} aria-hidden />
            {link.label}
          </NavLink>
        )
      })}
    </>
  )
}

export function AppShell() {
  const { user, settings, logout } = useAuth()

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = settings?.reducedMotion
      ? 'true'
      : 'false'
  }, [settings?.reducedMotion])

  return (
    <OverwhelmProvider>
      <div className={styles.shell}>
        <a href="#main" className={styles.skipLink}>
          Skip to main content
        </a>
        <header className={styles.topbar}>
          <NavLink to="/den" className={styles.brandLink}>
            <div className={styles.brand}>
              <div>
                <p className={styles.brandName}>Pocket Goblin</p>
                <p className={styles.brandTag}>
                  Your brain has enough tabs open.
                </p>
              </div>
            </div>
          </NavLink>
          <div className={styles.topActions}>
            <span className={styles.userChip}>{user?.displayName}</span>
            <NudgeTray />
            <Button variant="secondary" size="sm" onClick={() => void logout()}>
              <LogOut size={16} aria-hidden />
              Log out
            </Button>
          </div>
        </header>

        <div className={styles.body}>
          <nav className={styles.nav} aria-label="Primary">
            <NavItems links={primaryLinks} />
            <p className={styles.navGroup} id="more-shelves">
              More
            </p>
            <div aria-labelledby="more-shelves">
              <NavItems links={secondaryLinks} quiet />
            </div>
          </nav>
          <main className={styles.main} id="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        <FloatingCapture />
        <OverwhelmMode />
      </div>
    </OverwhelmProvider>
  )
}
