import type {
  CodexActivityItem,
  CodexActivityItemStatus,
  CodexAgentMessageActivityDetail,
  CodexCollaborationActivityDetail,
  CodexCommandActivityDetail,
  CodexDynamicToolCallActivityDetail,
  CodexFileChangeActivityDetail,
  CodexHookPromptActivityDetail,
  CodexImageGenerationActivityDetail,
  CodexImageViewActivityDetail,
  CodexMcpToolCallActivityDetail,
  CodexReasoningActivityDetail,
  CodexReviewActivityDetail,
  CodexSdkCommandAction,
  CodexSdkCollabAgentState,
  CodexSdkDynamicToolCallOutputContentItem,
  CodexSdkFileChange,
  CodexSdkHookPromptFragment,
  CodexSdkMcpToolCallAppContext,
  CodexSdkMemoryCitation,
  CodexSdkThreadItem,
  CodexSdkWebSearchAction,
  CodexSubAgentActivityDetail,
  CodexWebSearchActivityDetail,
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

function structuredOneLine(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? oneLine(serialized) : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function commandActions(value: unknown): CodexSdkCommandAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((action) => isRecord(action) && typeof action.type === 'string')) return undefined
  return value as CodexSdkCommandAction[]
}

function fileChanges(value: unknown): CodexSdkFileChange[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((change) => isRecord(change) && typeof change.path === 'string')) return undefined
  return value as CodexSdkFileChange[]
}

function hookFragments(value: unknown): CodexSdkHookPromptFragment[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((fragment) => isRecord(fragment)
    && typeof fragment.text === 'string'
    && typeof fragment.hookRunId === 'string')) return undefined
  return value as CodexSdkHookPromptFragment[]
}

function dynamicContentItems(value: unknown): CodexSdkDynamicToolCallOutputContentItem[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value)) return undefined
  if (!value.every((contentItem) => isRecord(contentItem)
    && ((contentItem.type === 'inputText' && typeof contentItem.text === 'string')
      || (contentItem.type === 'inputImage' && typeof contentItem.imageUrl === 'string')))) return undefined
  return value as CodexSdkDynamicToolCallOutputContentItem[]
}

function mcpAppContext(value: unknown): CodexSdkMcpToolCallAppContext | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || typeof value.connectorId !== 'string') return undefined
  const nullableFields = ['linkId', 'resourceUri', 'appName', 'templateId', 'actionName'] as const
  if (!nullableFields.every((field) => typeof value[field] === 'string' || value[field] === null)) return undefined
  return value as unknown as CodexSdkMcpToolCallAppContext
}

function memoryCitation(value: unknown): CodexSdkMemoryCitation | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.threadIds)) return undefined
  if (!value.threadIds.every((threadId) => typeof threadId === 'string')) return undefined
  if (!value.entries.every((entry) => isRecord(entry)
    && typeof entry.path === 'string'
    && typeof entry.lineStart === 'number'
    && typeof entry.lineEnd === 'number'
    && typeof entry.note === 'string')) return undefined
  return value as unknown as CodexSdkMemoryCitation
}

function webSearchAction(value: unknown): CodexSdkWebSearchAction | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  switch (value.type) {
    case 'search':
      if (!(typeof value.query === 'string' || value.query === null)) return undefined
      if (!(value.queries === null || (Array.isArray(value.queries) && value.queries.every((query) => typeof query === 'string')))) return undefined
      return value as CodexSdkWebSearchAction
    case 'openPage':
      return typeof value.url === 'string' || value.url === null ? value as CodexSdkWebSearchAction : undefined
    case 'findInPage':
      return (typeof value.url === 'string' || value.url === null)
        && (typeof value.pattern === 'string' || value.pattern === null)
        ? value as CodexSdkWebSearchAction
        : undefined
    case 'other':
      return { type: 'other' }
    default:
      return undefined
  }
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : undefined
}

function collabAgentStates(value: unknown): Record<string, CodexSdkCollabAgentState | undefined> | undefined {
  if (!isRecord(value)) return undefined
  if (!Object.values(value).every((state) => state === undefined || (isRecord(state)
    && typeof state.status === 'string'
    && (typeof state.message === 'string' || state.message === null)))) return undefined
  return value as Record<string, CodexSdkCollabAgentState | undefined>
}

function hasDefinedField<K extends keyof CodexSdkThreadItem>(
  item: CodexSdkThreadItem,
  field: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(item, field) && item[field] !== undefined
}

function commandActivityDetail(
  item: CodexSdkThreadItem,
  actions: CodexSdkCommandAction[] | undefined,
): CodexCommandActivityDetail {
  return {
    type: 'commandExecution',
    ...(typeof item.command === 'string' ? { command: item.command } : {}),
    ...(actions !== undefined ? { commandActions: actions } : {}),
    ...(hasDefinedField(item, 'cwd') ? { cwd: item.cwd } : {}),
    ...(typeof item.processId === 'string' || item.processId === null ? { processId: item.processId } : {}),
    ...(typeof item.source === 'string' ? { source: item.source } : {}),
    ...(hasDefinedField(item, 'aggregatedOutput') ? { aggregatedOutput: item.aggregatedOutput } : {}),
    ...(typeof item.exitCode === 'number' || item.exitCode === null ? { exitCode: item.exitCode } : {}),
    ...(typeof item.durationMs === 'number' || item.durationMs === null ? { durationMs: item.durationMs } : {}),
  }
}

function fileChangeActivityDetail(
  item: CodexSdkThreadItem,
  changes: CodexSdkFileChange[] | undefined,
): CodexFileChangeActivityDetail {
  return {
    type: 'fileChange',
    ...(changes !== undefined ? { changes } : {}),
    ...(hasDefinedField(item, 'status') ? { applyStatus: item.status } : {}),
    ...(hasDefinedField(item, 'error') ? { error: item.error } : {}),
  }
}

function mcpToolCallActivityDetail(item: CodexSdkThreadItem): CodexMcpToolCallActivityDetail {
  const appContext = mcpAppContext(item.appContext)
  return {
    type: 'mcpToolCall',
    ...(typeof item.server === 'string' ? { server: item.server } : {}),
    ...(typeof item.tool === 'string' ? { tool: item.tool } : {}),
    ...(appContext !== undefined ? { appContext } : {}),
    ...(typeof item.mcpAppResourceUri === 'string' ? { mcpAppResourceUri: item.mcpAppResourceUri } : {}),
    ...(typeof item.pluginId === 'string' || item.pluginId === null ? { pluginId: item.pluginId } : {}),
    ...(hasDefinedField(item, 'arguments') ? { arguments: item.arguments } : {}),
    ...(hasDefinedField(item, 'result') ? { result: item.result } : {}),
    ...(hasDefinedField(item, 'error') ? { error: item.error } : {}),
    ...(typeof item.durationMs === 'number' || item.durationMs === null ? { durationMs: item.durationMs } : {}),
  }
}

function dynamicToolCallActivityDetail(item: CodexSdkThreadItem): CodexDynamicToolCallActivityDetail {
  const contentItems = dynamicContentItems(item.contentItems)
  return {
    type: 'dynamicToolCall',
    ...(typeof item.namespace === 'string' || item.namespace === null ? { namespace: item.namespace } : {}),
    ...(typeof item.tool === 'string' ? { tool: item.tool } : {}),
    ...(hasDefinedField(item, 'arguments') ? { arguments: item.arguments } : {}),
    ...(contentItems !== undefined ? { contentItems } : {}),
    ...(typeof item.success === 'boolean' || item.success === null ? { success: item.success } : {}),
    ...(hasDefinedField(item, 'result') ? { result: item.result } : {}),
    ...(hasDefinedField(item, 'error') ? { error: item.error } : {}),
    ...(typeof item.durationMs === 'number' || item.durationMs === null ? { durationMs: item.durationMs } : {}),
  }
}

function collaborationActivityDetail(item: CodexSdkThreadItem): CodexCollaborationActivityDetail {
  const currentReceiverIds = stringArray(item.receiverThreadIds)
  const legacyReceiverId = typeof item.receiverThreadId === 'string'
    ? item.receiverThreadId
    : typeof item.newThreadId === 'string'
      ? item.newThreadId
      : undefined
  const receiverThreadIds = currentReceiverIds ?? (legacyReceiverId ? [legacyReceiverId] : undefined)
  const currentAgentStates = collabAgentStates(item.agentsStates)
  const legacyAgentStatus = typeof item.agentStatus === 'string'
    ? { status: item.agentStatus, message: null }
    : isRecord(item.agentStatus) && typeof item.agentStatus.status === 'string'
      ? {
          status: item.agentStatus.status,
          message: typeof item.agentStatus.message === 'string' ? item.agentStatus.message : null,
        }
      : undefined
  const agentsStates = currentAgentStates ?? (legacyReceiverId && legacyAgentStatus
    ? { [legacyReceiverId]: legacyAgentStatus }
    : undefined)

  return {
    type: 'collabAgentToolCall',
    ...(typeof item.tool === 'string' ? { tool: item.tool } : {}),
    ...(typeof item.senderThreadId === 'string' ? { senderThreadId: item.senderThreadId } : {}),
    ...(receiverThreadIds ? { receiverThreadIds } : {}),
    ...(typeof item.prompt === 'string' || item.prompt === null ? { prompt: item.prompt } : {}),
    ...(typeof item.model === 'string' || item.model === null ? { model: item.model } : {}),
    ...(typeof item.reasoningEffort === 'string' || item.reasoningEffort === null
      ? { reasoningEffort: item.reasoningEffort }
      : {}),
    ...(agentsStates ? { agentsStates } : {}),
  }
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
      {
        const citation = memoryCitation(item.memoryCitation)
        const activityDetail: CodexAgentMessageActivityDetail = {
          type: 'agentMessage',
          ...(typeof item.phase === 'string' || item.phase === null ? { phase: item.phase } : {}),
          ...(citation !== undefined ? { memoryCitation: citation } : {}),
        }
        return {
          ...base,
          kind: 'commentary',
          title: completed ? 'Update' : 'Working',
          content: item.text || undefined,
          activityDetail,
        }
      }
    case 'reasoning':
      {
        const activityDetail: CodexReasoningActivityDetail = {
          type: 'reasoning',
          ...(Array.isArray(item.summary) && item.summary.every((part) => typeof part === 'string')
            ? { summary: item.summary }
            : {}),
          ...(Array.isArray(item.content) && item.content.every((part) => typeof part === 'string')
            ? { content: item.content }
            : {}),
        }
        return {
          ...base,
          kind: 'reasoning',
          title: completed ? 'Thought' : 'Thinking',
          content: reasoningText(item),
          activityDetail,
        }
      }
    case 'plan':
      return { ...base, kind: 'plan', title: completed ? 'Updated the plan' : 'Updating the plan', content: item.text || undefined }
    case 'commandExecution': {
      const actions = commandActions(item.commandActions)
      return {
        ...base,
        kind: 'command',
        title: commandTitle(actions?.[0], completed),
        detail: item.command || undefined,
        activityDetail: commandActivityDetail(item, actions),
      }
    }
    case 'fileChange': {
      const changes = fileChanges(item.changes)
      const paths = changes?.map((change) => change.path).filter((path): path is string => Boolean(path)) ?? []
      const count = paths.length
      const action = completed ? 'Edited' : 'Editing'
      return {
        ...base,
        kind: 'file_change',
        title: count === 1 ? `${action} ${paths[0]}` : `${action} ${count || 'multiple'} files`,
        detail: count > 1 ? paths.join('\n') : undefined,
        activityDetail: fileChangeActivityDetail(item, changes),
      }
    }
    case 'webSearch': {
      const action = webSearchAction(item.action)
      const activityDetail: CodexWebSearchActivityDetail = {
        type: 'webSearch',
        ...(typeof item.query === 'string' ? { query: item.query } : {}),
        ...(action !== undefined ? { action } : {}),
      }
      return {
        ...base,
        kind: 'web_search',
        title: completed ? 'Searched the web' : 'Searching the web',
        detail: item.query || undefined,
        activityDetail,
      }
    }
    case 'mcpToolCall': {
      const tool = [item.server, item.tool].filter(Boolean).join('.')
      return {
        ...base,
        kind: 'mcp_tool',
        title: `${completed ? 'Called' : 'Calling'} ${tool || 'a tool'}`,
        detail: structuredOneLine(item.arguments),
        activityDetail: mcpToolCallActivityDetail(item),
      }
    }
    case 'dynamicToolCall': {
      const tool = [item.namespace, item.tool].filter(Boolean).join('.')
      return {
        ...base,
        kind: 'dynamic_tool',
        title: `${completed ? 'Called' : 'Calling'} ${tool || 'a tool'}`,
        detail: structuredOneLine(item.arguments),
        activityDetail: dynamicToolCallActivityDetail(item),
      }
    }
    case 'collabAgentToolCall':
      return {
        ...base,
        kind: 'collaboration',
        title: collaborationTitle(item.tool, completed),
        detail: oneLine(item.prompt),
        activityDetail: collaborationActivityDetail(item),
      }
    case 'subAgentActivity': {
      const activityDetail: CodexSubAgentActivityDetail = {
        type: 'subAgentActivity',
        ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
        ...(typeof item.agentThreadId === 'string' ? { agentThreadId: item.agentThreadId } : {}),
        ...(typeof item.agentPath === 'string' ? { agentPath: item.agentPath } : {}),
      }
      return {
        ...base,
        kind: 'subagent',
        title: completed ? 'Updated agent activity' : 'Agent activity',
        detail: oneLine(item.agentPath),
        activityDetail,
      }
    }
    case 'imageView': {
      const path = pathText(item.path)
      const activityDetail: CodexImageViewActivityDetail = {
        type: 'imageView',
        ...(path ? { path } : {}),
      }
      return {
        ...base,
        kind: 'image',
        title: completed ? 'Viewed an image' : 'Viewing an image',
        detail: path,
        activityDetail,
      }
    }
    case 'imageGeneration': {
      const activityDetail: CodexImageGenerationActivityDetail = {
        type: 'imageGeneration',
        ...(typeof item.status === 'string' ? { generationStatus: item.status } : {}),
        ...(typeof item.revisedPrompt === 'string' || item.revisedPrompt === null
          ? { revisedPrompt: item.revisedPrompt }
          : {}),
        ...(typeof item.result === 'string' ? { result: item.result } : {}),
        ...(typeof item.savedPath === 'string' ? { savedPath: item.savedPath } : {}),
      }
      return {
        ...base,
        kind: 'image',
        title: completed ? 'Generated an image' : 'Generating an image',
        activityDetail,
      }
    }
    case 'sleep':
      return {
        ...base,
        kind: 'sleep',
        title: completed ? 'Waited' : 'Waiting',
        detail: typeof item.durationMs === 'number' ? `${Math.round(item.durationMs / 1000)}s` : undefined,
        activityDetail: {
          type: 'sleep',
          ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
        },
      }
    case 'enteredReviewMode':
    case 'exitedReviewMode': {
      const activityDetail: CodexReviewActivityDetail = {
        type: item.type,
        ...(typeof item.review === 'string' ? { review: item.review } : {}),
      }
      return {
        ...base,
        kind: 'review',
        title: item.type === 'enteredReviewMode' ? 'Entered review mode' : 'Exited review mode',
        detail: oneLine(item.review),
        activityDetail,
      }
    }
    case 'contextCompaction':
    case 'compaction':
      return {
        ...base,
        kind: 'compaction',
        title: completed ? 'Compacted context' : 'Compacting context',
        activityDetail: { type: 'contextCompaction' },
      }
    case 'hookPrompt': {
      const fragments = hookFragments(item.fragments)
      const activityDetail: CodexHookPromptActivityDetail = {
        type: 'hookPrompt',
        ...(fragments !== undefined ? { fragments } : {}),
      }
      return {
        ...base,
        kind: 'other',
        title: completed ? 'Applied hook context' : 'Applying hook context',
        content: fragments?.map((fragment) => fragment.text).join('\n') || undefined,
        activityDetail,
      }
    }
    default:
      if (!item.type) return null
      return {
        ...base,
        kind: 'other',
        title: `${completed ? 'Completed' : 'Running'} ${item.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`,
      }
  }
}
