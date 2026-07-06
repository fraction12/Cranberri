import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { ReposProvider } from './state/repos'
import { CodexProvider } from './state/codex'
import { SettingsProvider } from './state/settings'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ReposProvider>
        <SettingsProvider>
          <CodexProvider>
            <App />
          </CodexProvider>
        </SettingsProvider>
      </ReposProvider>
    </QueryClientProvider>
  </StrictMode>
)
