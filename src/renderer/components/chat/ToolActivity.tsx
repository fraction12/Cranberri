import type {
  CodexActivityItemStatus,
  CodexDynamicToolCallActivityDetail,
  CodexMcpToolCallActivityDetail,
} from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import { markdownMediaSourceFromUrl } from './MarkdownMedia'
import {
  ActivityDisclosure,
  ActivityPayload,
  activityPreview,
  formatActivityDuration,
  hasActivityValue,
} from './ActivityDisclosure'

type ToolDetail = CodexMcpToolCallActivityDetail | CodexDynamicToolCallActivityDetail

export function ToolActivity({ detail, status }: { detail: ToolDetail; status: CodexActivityItemStatus }) {
  const dynamic = detail.type === 'dynamicToolCall' ? detail : null
  const mcp = detail.type === 'mcpToolCall' ? detail : null
  const toolName = [mcp?.server ?? dynamic?.namespace, detail.tool].filter(Boolean).join('.')
  const failed = status === 'failed' || status === 'declined' || hasActivityValue(detail.error) || dynamic?.success === false
  const statusLabel = failed ? 'Failed' : status === 'running' ? 'Running' : 'Completed'
  const contentItems = Array.isArray(dynamic?.contentItems) ? dynamic.contentItems : []
  const hasDetails = hasActivityValue(detail.arguments)
    || hasActivityValue(detail.result)
    || hasActivityValue(detail.error)
    || contentItems.length > 0
    || Boolean(mcp?.appContext || mcp?.pluginId || mcp?.mcpAppResourceUri)
  const duration = formatActivityDuration(detail.durationMs) ?? undefined

  return (
    <ActivityDisclosure
      title={toolName || (status === 'running' ? 'Running tool' : 'Tool call')}
      status={statusLabel}
      preview={hasActivityValue(detail.arguments) ? activityPreview(detail.arguments) : undefined}
      meta={duration}
      failed={failed}
      emptyLabel={!hasDetails ? 'No tool details' : undefined}
    >
      {hasDetails ? (
        <>
          <ActivityPayload label="Arguments" value={detail.arguments} />
          {mcp?.appContext && <ActivityPayload label="App context" value={mcp.appContext} />}
          {(mcp?.pluginId || mcp?.mcpAppResourceUri) && (
            <div className={`${typeStyle({ role: 'metadata', tone: 'tertiary' })} flex flex-wrap gap-x-3 gap-y-1`}>
              {mcp.pluginId && <span>Plugin {mcp.pluginId}</span>}
              {mcp.mcpAppResourceUri && <span className="break-all">Resource {mcp.mcpAppResourceUri}</span>}
            </div>
          )}
          {contentItems.map((content, index) => {
            if (content.type === 'inputText') return <ActivityPayload key={`text-${index}`} label={`Input ${index + 1}`} value={content.text} />
            const source = markdownMediaSourceFromUrl(content.imageUrl)
            return source?.kind === 'image' ? (
              <figure key={`image-${index}`} className="min-w-0">
                <img src={source.src} alt="Tool input" loading="lazy" className="max-h-72 max-w-full rounded object-contain ring-1 ring-app-border/70" />
                <figcaption className={`${typeStyle({ role: 'metadata', tone: 'tertiary' })} mt-1 break-all`}>{content.imageUrl}</figcaption>
              </figure>
            ) : <ActivityPayload key={`image-${index}`} label={`Image input ${index + 1}`} value={content.imageUrl} />
          })}
          <ActivityPayload label="Result" value={detail.result} />
          <ActivityPayload label="Error" value={detail.error} danger />
        </>
      ) : undefined}
    </ActivityDisclosure>
  )
}
