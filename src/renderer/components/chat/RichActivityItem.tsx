import type { CodexActivityDetail, CodexActivityItemStatus } from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import { ActivityDisclosure, ActivityPayload, activityPreview, formatActivityDuration } from './ActivityDisclosure'
import { CollaborationActivity } from './CollaborationActivity'
import { CommandActivity } from './CommandActivity'
import { FileChangeActivity } from './FileChangeActivity'
import { SearchImageActivity } from './SearchImageActivity'
import { ToolActivity } from './ToolActivity'

export function hasRichActivityPresentation(detail?: CodexActivityDetail): boolean {
  return Boolean(detail && detail.type !== 'hookPrompt' && detail.type !== 'agentMessage' && detail.type !== 'reasoning')
}

export function RichActivityItem({
  detail,
  status,
}: {
  detail?: CodexActivityDetail
  status: CodexActivityItemStatus
}) {
  if (!detail) return null

  switch (detail.type) {
    case 'commandExecution':
      return <CommandActivity detail={detail} status={status} />
    case 'fileChange':
      return <FileChangeActivity detail={detail} status={status} />
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return <ToolActivity detail={detail} status={status} />
    case 'webSearch':
    case 'imageView':
    case 'imageGeneration':
      return <SearchImageActivity detail={detail} status={status} />
    case 'collabAgentToolCall':
      return <CollaborationActivity detail={detail} status={status} />
    case 'subAgentActivity': {
      const identity = detail.agentPath?.trim() || detail.agentThreadId?.trim()
      const title = detail.kind === 'started'
        ? 'Subagent started'
        : detail.kind === 'interrupted'
          ? 'Subagent interrupted'
          : detail.kind === 'interacted'
            ? 'Subagent updated'
            : 'Subagent activity'
      return (
        <ActivityDisclosure title={title} preview={identity ? activityPreview(identity) : undefined} failed={status === 'failed'} emptyLabel={!identity ? 'No agent details' : undefined}>
          {identity ? (
            <>
              <ActivityPayload label="Agent" value={detail.agentPath} />
              <ActivityPayload label="Thread" value={detail.agentThreadId} />
            </>
          ) : undefined}
        </ActivityDisclosure>
      )
    }
    case 'sleep': {
      const duration = formatActivityDuration(detail.durationMs)
      return <ActivityDisclosure title={status === 'running' ? 'Waiting' : 'Waited'} meta={duration ?? undefined} />
    }
    case 'enteredReviewMode':
    case 'exitedReviewMode': {
      const entered = detail.type === 'enteredReviewMode'
      return (
        <ActivityDisclosure
          title={entered ? 'Entered review mode' : 'Exited review mode'}
          preview={detail.review ? activityPreview(detail.review) : undefined}
        >
          {detail.review ? <ActivityPayload label="Review" value={detail.review} /> : undefined}
        </ActivityDisclosure>
      )
    }
    case 'contextCompaction':
      return <div className={`${typeStyle({ role: 'body', tone: 'secondary' })} py-1`}>Compacted context</div>
    case 'hookPrompt':
    case 'agentMessage':
    case 'reasoning':
      return null
  }
}
