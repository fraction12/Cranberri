import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { ReposProvider } from './state/repos'
import { CodexProvider } from './state/codex'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReposProvider>
        <CodexProvider>
          <App />
        </CodexProvider>
      </ReposProvider>
    </QueryClientProvider>
  </StrictMode>
)
