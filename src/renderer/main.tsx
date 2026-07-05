import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ReposProvider } from './state/repos'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReposProvider>
      <App />
    </ReposProvider>
  </StrictMode>
)
