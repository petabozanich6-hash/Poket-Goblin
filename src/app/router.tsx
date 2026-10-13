import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useAuth } from '@/features/auth/useAuth'
import { AssistantPage } from '@/pages/AssistantPage'
import { AuthPage } from '@/pages/AuthPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { CapturePage } from '@/pages/CapturePage'
import { DocumentsPage } from '@/pages/DocumentsPage'
import { HomePage } from '@/pages/HomePage'
import { InboxPage } from '@/pages/InboxPage'
import { LifePage } from '@/pages/LifePage'
import { PlanPage } from '@/pages/PlanPage'
import { SearchPage } from '@/pages/SearchPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TasksPage } from '@/pages/TasksPage'

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
        <Route
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route path="/den" element={<HomePage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/life" element={<LifePage />} />
          <Route path="/shopping" element={<Navigate to="/life" replace />} />
          <Route path="/notes" element={<Navigate to="/life" replace />} />
          <Route path="/find" element={<SearchPage />} />
          <Route path="/ask" element={<AssistantPage />} />
          <Route path="/vault" element={<DocumentsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
