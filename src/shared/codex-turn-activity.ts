import type {
  CodexActivityItem,
  CodexActivityItemStatus,
  CodexSdkCommandAction,
  CodexSdkThreadItem,
} from './codex'

export type CodexItemLifecycle = 'started' | 'completed'

export function codexStatusName(status: unknown): string | null {
  if (typeof status === 'string') return status
  if (status && typeof status === 'object' && 'type' in status) {
    const type = (status as { type?: unknown }).type
    return typeof type === 'string' ? type : null
  }
  return null
}

function normalizeStatus(item: CodexSdkThreadItem, lifecycle: CodexItemLifecycle): CodexActivityItemStatus {
  const status = codexStatusName(item.status)
  if (status === 'failed' || item.success === false || item.error) return 'failed'
  if (status === 'declined') return 'declined'
  if (status === 'inProgress' || status === 'running' || lifecycle === 'started') return 'running'
  return 'completed'
}

function oneLine(value: string | null | undefined, max = 160): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function pathText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'path' in value) {
    const path = (value as { path?: unknown }).path
    return typeof path === 'string' ? path : undefined
  }
  return undefined
}

export function codexItemText(item: CodexSdkThreadItem): string {
  if (!Array.isArray(item.content)) return ''
  return item.content
    .map((part) => typeof part === 'string' ? part : part.text)
    .filter((part): part is string => Boolean(part))
    .join('\n')
}

function reasoningText(item: CodexSdkThreadItem): string | undefined {
  return [item.summary?.join('\n'), codexItemText(item)].filter(Boolean).join('\n') || undefined
}

function commandTitle(action: CodexSdkCommandAction | undefined, completed: boolean): string {
  if (action?.type === 'read') {
    const target = oneLine(action.name) ?? pathText(action.path)
    return target ? `${completed ? 'Read' : 'Reading'} ${target}` : completed ? 'Read a file' : 'Reading a file'
  }
  if (action?.type === 'listFiles') return completed ? 'Listed files' : 'Listing files'
  if (action?.type === 'search') {
    const query = oneLine(action.query)
    return query ? `${completed ? 'Searched for' : 'Searching for'} ${query}` : completed ? 'Searched files' : 'Searching files'
  }
  return completed ? 'Ran a command' : 'Running a command'
}

function collaborationTitle(tool: string | undefined, completed: boolean): string {
  switch (tool) {
    case 'spawnAgent':
    case 'spawn_agent':
      return completed ? 'Started an agent' : 'Starting an agent'
    case 'sendInput':
    case 'send_input':
      return completed ? 'Sent direction to an agent' : 'Sending direction to an agent'
    case 'resumeAgent':
    case 'resume_agent':
      return completed ? 'Resumed an agent' : 'Resuming an agent'
    case 'wait':
      return completed ? 'Waited for agents' : 'Waiting for agents'
    case 'closeAgent':
    case 'close_agent':
      return completed ? 'Closed an agent' : 'Closing an agent'
    default:
      return completed ? 'Used an agent' : 'Working with an agent'
  }
}

function baseActivity(
  item: CodexSdkThreadItem,
  lifecycle: CodexItemLifecycle,
  at: number,
): Pick<CodexActivityItem, 'id' | 'status' | 'startedAt' | 'completedAt' | 'durationMs'> {
  const status = normalizeStatus(item, lifecycle)
  return {
    id: item.id ?? `${item.type ?? 'item'}-${at}`,
    status,
    ...(lifecycle === 'started' ? { startedAt: at } : { completedAt: at }),
    ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
  }
}

export function normalizeCodexActivityItem(
  item: CodexSdkThreadItem,
  lifecycle: CodexItemLifecycle,
  at: number,
): CodexActivityItem | null {
  const base = baseActivity(item, lifecycle, at)
  const completed = base.status !== 'running'

  switch (item.type) {
    case 'userMessage':
      return null
    case 'agentMessage':
      if (item.phase !== 'commentary') return null
      return {
        ...base,
        kind: 'commentary',
        title: completed ? 'Update' : 'Working',
        content: item.text || undefined,
      }
    case 'reasoning':
      return {
        ...base,
        kind: 'reasoning',
        title: completed ? 'Thought' : 'Thinking',
        content: reasoningText(item),
      }
    case 'plan':
      return { ...base, kind: 'plan', title: completed ? 'Updated the plan' : 'Updating the plan', content: item.text || undefined }
    case 'commandExecution':
      return {
        ...base,
        kind: 'command',
        title: commandTitle(item.commandActions?.[0], completed),
        detail: item.command || undefined,
      }
    case 'fileChange': {
      const paths = item.changes?.map((change) => change.path).filter((path): path is string => Boolean(path)) ?? []
      const count = paths.length
      const action = completed ? 'Edited' : 'Editing'
      return {
        ...base,
        kind: 'file_change',
        title: count === 1 ? `${action} ${paths[0]}` : `${action} ${count || 'multiple'} files`,
        detail: count > 1 ? paths.join('\n') : undefined,
      }
    }
    case 'webSearch':
      return { ...base, kind: 'web_search', title: completed ? 'Searched the web' : 'Searching the web', detail: item.query || undefined }
    case 'mcpToolCall': {
      const tool = [item.server, item.tool].filter(Boolean).join('.')
      return { ...base, kind: 'mcp_tool', title: `${completed ? 'Called' : 'Calling'} ${tool || 'a tool'}`, detail: oneLine(JSON.stringify(item.arguments)) }
    }
    case 'dynamicToolCall': {
      const tool = [item.namespace, item.tool].filter(Boolean).join('.')
      return { ...base, kind: 'dynamic_tool', title: `${completed ? 'Called' : 'Calling'} ${tool || 'a tool'}`, detail: oneLine(JSON.stringify(item.arguments)) }
    }
    case 'collabAgentToolCall':
      return { ...base, kind: 'collaboration', title: collaborationTitle(item.tool, completed), detail: oneLine(item.prompt) }
    case 'subAgentActivity':
      return { ...base, kind: 'subagent', title: completed ? 'Updated agent activity' : 'Agent activity', detail: oneLine(item.agentPath) }
    case 'imageView':
      return { ...base, kind: 'image', title: completed ? 'Viewed an image' : 'Viewing an image', detail: pathText(item.path) }
    case 'imageGeneration':
      return { ...base, kind: 'image', title: completed ? 'Generated an image' : 'Generating an image' }
    case 'sleep':
      return { ...base, kind: 'sleep', title: completed ? 'Waited' : 'Waiting', detail: typeof item.durationMs === 'number' ? `${Math.round(item.durationMs / 1000)}s` : undefined }
    case 'enteredReviewMode':
      return { ...base, kind: 'review', title: 'Entered review mode', detail: oneLine(item.review) }
    case 'exitedReviewMode':
      return { ...base, kind: 'review', title: 'Exited review mode', detail: oneLine(item.review) }
    case 'contextCompaction':
    case 'compaction':
      return { ...base, kind: 'compaction', title: completed ? 'Compacted context' : 'Compacting context' }
    case 'hookPrompt':
      return { ...base, kind: 'other', title: completed ? 'Applied hook context' : 'Applying hook context' }
    default:
      if (!item.type) return null
      return {
        ...base,
        kind: 'other',
        title: `${completed ? 'Completed' : 'Running'} ${item.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`,
      }
  }
}
