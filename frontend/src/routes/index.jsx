import { lazy, Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { FullScreenLoader, ProtectedRoute, PublicOnlyRoute } from './ProtectedRoute'
import { AuthCallbackPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '../pages/AuthPages'
import { AgentDetailPage, AgentsPage } from '../pages/AgentsPages'
import { ExecutionDetailPage, ExecutionsPage } from '../pages/ExecutionsPages'
import { WorkflowDetailPage, WorkflowsPage } from '../pages/WorkflowsPages'
import { ToolsPage } from '../pages/ToolsPage'
import { ApiKeysPage } from '../pages/ApiKeysPage'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/Feedback'

// Recharts is heavy: load dashboard/analytics lazily.
const DashboardPage = lazy(() => import('../pages/DashboardPage'))
const AnalyticsPage = lazy(() => import('../pages/AnalyticsPage'))
const SettingsPage = lazy(() => import('../pages/SettingsPage'))
const lazyEl = (el) => <Suspense fallback={<FullScreenLoader />}>{el}</Suspense>

function NotFound() {
  return <div className="flex min-h-[60vh] items-center justify-center"><EmptyState title="Page not found" description="The page you are looking for does not exist." action={<a href="/app/dashboard"><Button>Go to dashboard</Button></a>} /></div>
}

export const routes = [
  { element: <PublicOnlyRoute />, children: [
    { path: '/login', element: <LoginPage /> }, { path: '/signup', element: <SignupPage /> },
    { path: '/forgot-password', element: <ForgotPasswordPage /> }, { path: '/reset-password', element: <ResetPasswordPage /> },
  ] },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { element: <ProtectedRoute />, children: [{ path: '/app', element: <AppShell />, children: [
    { index: true, element: <Navigate to="dashboard" replace /> },
    { path: 'dashboard', element: lazyEl(<DashboardPage />) },
    { path: 'agents', element: <AgentsPage /> }, { path: 'agents/new', element: <AgentsPage /> }, { path: 'agents/:agentId', element: <AgentDetailPage /> },
    { path: 'executions', element: <ExecutionsPage /> }, { path: 'executions/:executionId', element: <ExecutionDetailPage /> },
    { path: 'workflows', element: <WorkflowsPage /> }, { path: 'workflows/:workflowId', element: <WorkflowDetailPage /> },
    { path: 'tools', element: <ToolsPage /> }, { path: 'api-keys', element: <ApiKeysPage /> },
    { path: 'analytics', element: lazyEl(<AnalyticsPage />) },
    { path: 'settings', element: <Navigate to="profile" replace /> },
    { path: 'settings/profile', element: lazyEl(<SettingsPage tab="profile" />) },
    { path: 'settings/security', element: lazyEl(<SettingsPage tab="security" />) },
    { path: '*', element: <NotFound /> },
  ] }] },
  { path: '/', element: <Navigate to="/app/dashboard" replace /> },
  { path: '*', element: <NotFound /> },
]