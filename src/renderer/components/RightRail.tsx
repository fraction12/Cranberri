import * as Tabs from '@radix-ui/react-tabs'
import { FileDiff, FileText, Ticket } from 'lucide-react'

export function RightRail() {
  return (
    <Tabs.Root defaultValue="diff" className="flex flex-col h-full bg-app-surface">
      <Tabs.List className="flex h-9 border-b border-app-border">
        <Tabs.Trigger value="diff" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <FileDiff className="w-4 h-4" /> Diff
        </Tabs.Trigger>
        <Tabs.Trigger value="files" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <FileText className="w-4 h-4" /> Files
        </Tabs.Trigger>
        <Tabs.Trigger value="issue" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <Ticket className="w-4 h-4" /> Issue
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="diff" className="flex-1 p-3 text-sm text-app-text-muted">
        No diff yet. Start a Codex thread to see changes.
      </Tabs.Content>
      <Tabs.Content value="files" className="flex-1 p-3 text-sm text-app-text-muted">
        No changed files.
      </Tabs.Content>
      <Tabs.Content value="issue" className="flex-1 p-3 text-sm text-app-text-muted">
        No Linear issue linked.
      </Tabs.Content>
    </Tabs.Root>
  )
}
