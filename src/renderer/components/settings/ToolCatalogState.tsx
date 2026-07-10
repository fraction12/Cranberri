import { Loader2 } from 'lucide-react'
import type { ToolCatalogSnapshot } from '@/shared/tools'

interface ToolCatalogStateProps {
  loading: boolean
  refreshStatus: ToolCatalogSnapshot['refresh']['status']
  hasEntries: boolean
  errorCode: string | null
}

export function ToolCatalogState({ loading, refreshStatus, hasEntries, errorCode }: ToolCatalogStateProps) {
  if (loading && !hasEntries) {
    return (
      <div className="flex items-center gap-2 border-y border-app-border px-3 py-4 text-xs text-app-text-muted" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading tool catalog...
      </div>
    )
  }
  if (refreshStatus === 'stale') {
    return <div className="border-y border-app-warning/30 bg-app-warning/5 px-3 py-2 text-xs text-app-text-muted" role="status">Showing saved tool status. Refresh needed.</div>
  }
  if (refreshStatus === 'failed' && hasEntries) {
    return <div className="border-y border-app-danger/30 bg-app-danger/5 px-3 py-2 text-xs text-app-text-muted" role="status">Refresh failed. Showing saved tool status{errorCode ? ` (${errorCode.slice(0, 80)})` : ''}.</div>
  }
  return null
}
