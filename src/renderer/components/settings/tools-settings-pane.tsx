import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ToolCatalogId } from '@/shared/tools'
import { useCodexWindows } from '../../state/codex'
import { useSettings } from '../../state/settings'
import { setToolPinned } from '../../state/tool-catalog-selectors'
import { useToolCatalog } from '../../state/tools'
import { ToolCatalogSettings } from './tool-catalog-settings'
import { SettingsPage } from './settings-page'

interface ToolsSettingsPaneProps {
  onNavigate: (tab: 'general' | 'apps') => void
}

export function ToolsSettingsPane({ onNavigate }: ToolsSettingsPaneProps) {
  const { activeThreadId } = useCodexWindows()
  const { settings, updateSection } = useSettings()
  const catalog = useToolCatalog(activeThreadId)
  const [pinningIds, setPinningIds] = useState<string[]>([])
  const entries = useMemo(() => catalog.data?.entries ?? [], [catalog.data?.entries])

  const runAction = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback)
    }
  }, [])

  const changePin = useCallback((toolId: ToolCatalogId, pinned: boolean) => {
    const entry = entries.find((candidate) => candidate.id === toolId)
    if (!entry) return
    setPinningIds((current) => [...current.filter((id) => id !== toolId), toolId])
    void runAction(() => updateSection('tools', (current) => setToolPinned(current, entry, pinned)), 'Could not update the Tools rail')
      .finally(() => setPinningIds((current) => current.filter((id) => id !== toolId)))
  }, [entries, runAction, updateSection])

  const openRelatedSettings = useCallback((toolId: ToolCatalogId) => {
    const source = entries.find((entry) => entry.id === toolId)?.source.kind
    onNavigate(source === 'mcp' || source === 'browser' ? 'apps' : 'general')
  }, [entries, onNavigate])

  return (
    <SettingsPage title="Tools" description="Choose which verified tools appear in the right rail.">
      <ToolCatalogSettings
        entries={entries}
        preferences={settings.tools}
        loading={catalog.isLoading}
        refreshing={catalog.refreshing}
        refreshStatus={catalog.data?.refresh.status ?? (catalog.isError ? 'failed' : 'fresh')}
        refreshErrorCode={catalog.data?.refresh.errorCode ?? (catalog.isError ? 'catalog-unavailable' : null)}
        testingToolIds={catalog.testingToolIds}
        pinningToolIds={pinningIds}
        onRefresh={() => void runAction(catalog.refresh, 'Could not refresh tools')}
        onTest={(toolId) => void runAction(() => catalog.testTool(toolId), 'Could not test this tool')}
        onOpenSettings={openRelatedSettings}
        onPinChange={changePin}
      />
    </SettingsPage>
  )
}
