import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { useAuth } from '@/features/auth/useAuth'
import { AuthPage } from '@/pages/AuthPage'
import { CapturePage } from '@/pages/CapturePage'
import { HomePage } from '@/pages/HomePage'
import { PlanPage } from '@/pages/PlanPage'
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
