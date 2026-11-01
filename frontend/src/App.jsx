import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from './app/AuthContext'
import { ThemeProvider } from './app/ThemeContext'
import { ToastProvider } from './components/ui/Toast'
import { routes } from './routes'

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: {
    staleTime: 15_000, refetchOnWindowFocus: false,
    retry: (count, err) => (err?.status >= 400 && err?.status < 500 ? false : count < 2),
  } } })
}

const queryClient = makeQueryClient()
const router = createBrowserRouter(routes)

export default function App() {
  return (
    <ThemeProvider><QueryClientProvider client={queryClient}><ToastProvider><AuthProvider><RouterProvider router={router} /></AuthProvider></ToastProvider></QueryClientProvider></ThemeProvider>
  )
}
