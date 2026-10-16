import {
  Crown,
  Home,
  Layers,
  LogOut,
  MessageCircleHeart,
  Settings,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useEffect } from 'react'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { NudgeTray } from '@/features/magical/NudgeTray'
import { OverwhelmMode } from '@/features/magical/OverwhelmMode'
import { OverwhelmProvider } from '@/features/magical/OverwhelmContext'
import { PlanLimitNotice } from '@/features/plan/PlanLimitNotice'
import { PlatformBanner } from '@/features/platform/PlatformBanner'
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt'
import { VoiceFab } from '@/features/voice/VoiceFab'
import { VoiceProvider } from '@/features/voice/VoiceContext'
import { readQueue } from '@/features/voice/offlineQueue'
import { SupportNotice } from '@/features/support/SupportNotice'

import styles from './AppShell.module.css'

type NavItem = {
  to: string
  label: string
  short: string
  icon: typeof Home
  end?: boolean
}

/** The four places a person ever needs. Everything else lives inside them. */
const destinations: NavItem[] = [
  { to: '/den', label: 'Home', short: 'Home', icon: Home, end: true },
  {
    to: '/tell',
    label: 'Tell the Goblin',
    short: 'Tell',
    icon: MessageCircleHeart,
  },
  { to: '/life', label: 'My Life', short: 'My Life', icon: Layers },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
]

const ownerDestination: NavItem = {
  to: '/hq',
  label: 'Goblin HQ',
  short: 'HQ',
  icon: Crown,
}

function NavItems({
  links,
  compact = false,
}: {
  links: NavItem[]
  compact?: boolean
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
                compact ? styles.tabLink : styles.navLink,
                link.to === '/hq' ? styles.navOwner : '',
                isActive ? styles.active : '',
              ]
                .filter(Boolean)
                .join(' ')
            }
          >
            <Icon size={compact ? 22 : 18} aria-hidden />
            <span>{compact ? link.short : link.label}</span>
          </NavLink>
        )
      })}
    </>
  )
}

export function AppShell() {
  const { user, settings, access, logout } = useAuth()

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = settings?.reducedMotion
      ? 'true'
      : 'false'
  }, [settings?.reducedMotion])

  async function signOut() {
    const waiting = user ? readQueue(user.id).length : 0
    if (
      waiting > 0 &&
      !window.confirm(
        `${waiting} thought${waiting === 1 ? ' is' : 's are'} saved on this device and not sent yet. Log out anyway? They’ll stay on this device until you sign back in here.`,
      )
    )
      return
    await logout()
  }

  return (
    <OverwhelmProvider>
      <VoiceProvider>
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
              <NavLink
                to="/support"
                style={{ fontWeight: 700, fontSize: '0.85rem' }}
              >
                Help & feedback
              </NavLink>
              <NudgeTray />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void signOut()}
              >
                <LogOut size={16} aria-hidden />
                Log out
              </Button>
            </div>
          </header>

          <div className={styles.body}>
            {/* Display only: Goblin HQ authorises every request on the server. */}
            <nav className={styles.nav} aria-label="Main">
              <NavItems
                links={
                  access?.isOwner
                    ? [...destinations, ownerDestination]
                    : destinations
                }
              />
            </nav>
            <main className={styles.main} id="main" tabIndex={-1}>
              <PlatformBanner />
              <PlanLimitNotice />
              <SupportNotice />
              <Outlet />
            </main>
          </div>
          <nav className={styles.tabBar} aria-label="Main">
            <NavItems
              links={
                access?.isOwner
                  ? [...destinations, ownerDestination]
                  : destinations
              }
              compact
            />
          </nav>
          <OverwhelmMode />
          <VoiceFab />
          <UpdatePrompt />
        </div>
      </VoiceProvider>
    </OverwhelmProvider>
  )
}
