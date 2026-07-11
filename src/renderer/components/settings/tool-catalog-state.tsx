import { Loader2 } from 'lucide-react'
import type { ToolCatalogSnapshot } from '@/shared/tools'
import { typeStyle } from '../../lib/typography'

interface ToolCatalogStateProps {
  loading: boolean
  refreshStatus: ToolCatalogSnapshot['refresh']['status']
  hasEntries: boolean
  errorCode: string | null
}

export function ToolCatalogState({ loading, refreshStatus, hasEntries, errorCode }: ToolCatalogStateProps) {
  if (loading && !hasEntries) {
    return (
      <div className={`flex items-center gap-2 rounded-md bg-app-bg px-3 py-4 ${typeStyle({ role: 'status', tone: 'secondary' })}`} role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tools...
      </div>
    )
  }
  if (refreshStatus === 'stale') {
    return <div className={`rounded-md bg-app-warning/5 px-3 py-2 ${typeStyle({ role: 'status', tone: 'warning' })}`} role="status">Showing the last verified tool status.</div>
  }
  if (refreshStatus === 'failed' && hasEntries) {
    return <div className={`rounded-md bg-app-danger/5 px-3 py-2 ${typeStyle({ role: 'status', tone: 'danger' })}`} role="status" title={errorCode ?? undefined}>Could not refresh tools. Showing the last verified status.</div>
  }
  return null
}
