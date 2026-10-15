import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useAuth } from '@/features/auth/useAuth'
import { AssistantPage } from '@/pages/AssistantPage'
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/pages/AccountRecoveryPages'
import { AuthPage } from '@/pages/AuthPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { CapturePage } from '@/pages/CapturePage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { HomePage } from '@/pages/HomePage'
import { InboxPage } from '@/pages/InboxPage'
import { LifePage } from '@/pages/LifePage'
import { MyLifeLayout, MyLifeOverview } from '@/pages/MyLifePage'
import { PlanPage } from '@/pages/PlanPage'
import { SearchPage } from '@/pages/SearchPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SubscriptionPage } from '@/pages/SubscriptionPage'
import { TasksPage } from '@/pages/TasksPage'
import { TellPage } from '@/pages/TellPage'
import { HqCustomerPage } from '@/pages/hq/HqCustomerPage'
import { HqCustomersPage } from '@/pages/hq/HqCustomersPage'
import { HqLayout } from '@/pages/hq/HqLayout'
import { HqOverviewPage } from '@/pages/hq/HqOverviewPage'
import { HqSecurityPage } from '@/pages/hq/HqSecurityPage'
import { HqSettingsPage } from '@/pages/hq/HqSettingsPage'

import { AppShell } from './AppShell'

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        Waking the goblin…
      </div>
    )
  }
  if (!isAuthenticated) return <Navigate to="/" replace />
  return children
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        Waking the goblin…
      </div>
    )
  }
  if (isAuthenticated) return <Navigate to="/den" replace />
  return children
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <PublicOnly>
              <AuthPage />
            </PublicOnly>
          }
        />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          {/* The four destinations. */}
          <Route path="/den" element={<HomePage />} />
          <Route path="/tell" element={<TellPage />} />
          <Route path="/life" element={<MyLifeLayout />}>
            <Route index element={<MyLifeOverview />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="lists" element={<LifePage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="review" element={<InboxPage />} />
            <Route path="search" element={<SearchPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/plan" element={<SubscriptionPage />} />
          {/* Still reachable from inside Tell the Goblin. */}
          <Route path="/ask" element={<AssistantPage />} />
          <Route path="/capture" element={<CapturePage />} />
          {/* Old addresses keep working. */}
          <Route path="/home" element={<Navigate to="/den" replace />} />
          <Route
            path="/tasks"
            element={<Navigate to="/life/tasks" replace />}
          />
          <Route
            path="/calendar"
            element={<Navigate to="/life/calendar" replace />}
          />
          <Route
            path="/shopping"
            element={<Navigate to="/life/lists" replace />}
          />
          <Route
            path="/notes"
            element={<Navigate to="/life/lists" replace />}
          />
          <Route path="/plan" element={<Navigate to="/life/plan" replace />} />
          <Route
            path="/find"
            element={<Navigate to="/life/search" replace />}
          />
          <Route
            path="/vault"
            element={<Navigate to="/life/documents" replace />}
          />
          <Route
            path="/inbox"
            element={<Navigate to="/life/review" replace />}
          />
          <Route path="/hq" element={<HqLayout />}>
            <Route index element={<HqOverviewPage />} />
            <Route path="customers" element={<HqCustomersPage />} />
            <Route path="customers/:id" element={<HqCustomerPage />} />
            <Route path="settings" element={<HqSettingsPage />} />
            <Route path="security" element={<HqSecurityPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
