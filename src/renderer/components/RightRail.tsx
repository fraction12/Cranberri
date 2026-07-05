import * as Tabs from '@radix-ui/react-tabs'
import { FileDiff, FileText, Ticket } from 'lucide-react'
import { useGitStatus, useGitDiff } from '../state/git'

export function RightRail() {
  const { data: status, isLoading: statusLoading } = useGitStatus()
  const { data: diff, isLoading: diffLoading } = useGitDiff()

  return (
    <Tabs.Root defaultValue="files" className="flex flex-col h-full bg-app-surface">
      <Tabs.List className="flex h-9 border-b border-app-border">
        <Tabs.Trigger value="files" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <FileText className="w-4 h-4" /> Files
        </Tabs.Trigger>
        <Tabs.Trigger value="diff" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <FileDiff className="w-4 h-4" /> Diff
        </Tabs.Trigger>
        <Tabs.Trigger value="issue" className="flex-1 flex items-center justify-center gap-1.5 text-xs text-app-text-muted hover:text-app-text data-[state=active]:text-app-text data-[state=active]:bg-app-surface-2">
          <Ticket className="w-4 h-4" /> Issue
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="files" className="flex-1 overflow-y-auto p-3">
        {statusLoading ? (
          <div className="text-sm text-app-text-muted">Loading...</div>
        ) : status?.length ? (
          <ul className="space-y-1">
            {status.map((file) => (
              <li key={file.path} className="flex items-center justify-between text-sm">
                <span className="truncate" title={file.path}>{file.path}</span>
                <span className="text-xs text-app-text-muted uppercase">{file.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-app-text-muted">No changed files.</div>
        )}
      </Tabs.Content>

      <Tabs.Content value="diff" className="flex-1 overflow-y-auto p-3 text-xs">
        {diffLoading ? (
          <div className="text-sm text-app-text-muted">Loading...</div>
        ) : diff?.files.length ? (
          <div className="space-y-4">
            {diff.files.map((file, i) => (
              <div key={i} className="border border-app-border rounded">
                <div className="px-2 py-1 bg-app-surface-2 text-app-text font-medium border-b border-app-border">
                  {file.to}
                </div>
                <div className="p-2 space-y-1 font-mono">
                  {file.chunks.map((chunk, ci) => (
                    <div key={ci} className="space-y-0.5">
                      <div className="text-app-text-muted">
                        @@ -{chunk.oldStart},{chunk.oldLines} +{chunk.newStart},{chunk.newLines} @@
                      </div>
                      {chunk.changes.map((change, li) => {
                        const color = change.type === 'add' ? 'text-app-accent' : change.type === 'del' ? 'text-app-danger' : 'text-app-text-muted'
                        return (
                          <div key={li} className={color}>
                            {change.type === 'add' ? '+' : change.type === 'del' ? '-' : ' '}
                            {' '}
                            {change.line}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-app-text-muted">No diff yet. Start a Codex thread to see changes.</div>
        )}
      </Tabs.Content>

      <Tabs.Content value="issue" className="flex-1 p-3 text-sm text-app-text-muted">
        No Linear issue linked.
      </Tabs.Content>
    </Tabs.Root>
  )
}
