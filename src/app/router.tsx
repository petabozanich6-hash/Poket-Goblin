import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { LandingPage } from '@/pages/LandingPage'

/**
 * Temporary router for the migration foundation.
 * Floot routes and screens will replace this shell — do not invent features here.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
