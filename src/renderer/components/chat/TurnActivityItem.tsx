import {
  Brain,
  Clock3,
  FilePenLine,
  Image,
  ListChecks,
  MessageSquareMore,
  Search,
  ShieldCheck,
  SquareTerminal,
  Users,
  Wrench,
} from 'lucide-react'
import { InlineApproval } from './InlineApproval'
import { formatInlineCodexText } from './mention-pill'
import { cn } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type { CodexActivityItem, CodexMessage, PendingApproval } from '@/shared/codex'

const ICONS = {
  commentary: MessageSquareMore,
  reasoning: Brain,
  plan: ListChecks,
  command: SquareTerminal,
  file_change: FilePenLine,
  web_search: Search,
  mcp_tool: Wrench,
  dynamic_tool: Wrench,
  collaboration: Users,
  subagent: Users,
  image: Image,
  sleep: Clock3,
  review: ShieldCheck,
  compaction: ListChecks,
  steering: MessageSquareMore,
  other: Wrench,
} as const

export function TurnActivityItem({
  item,
  message,
  approvals,
  resolvingApprovalId,
  onResolveApproval,
}: {
  item: CodexActivityItem
  message?: CodexMessage
  approvals: PendingApproval[]
  resolvingApprovalId?: string | null
  onResolveApproval?: (approvalId: string, decision: 'approve' | 'deny') => void
}) {
  const Icon = ICONS[item.kind]
  const content = message?.content || item.content
  const isNarrative = item.kind === 'reasoning' || item.kind === 'commentary' || item.kind === 'plan'

  if (item.kind === 'steering') {
    const failed = item.status === 'failed' || item.status === 'declined'
    return (
      <div data-turn-item={item.id} className="flex justify-end py-0.5">
        <div className={cn(
          typeStyle({ role: 'body', tone: failed ? 'danger' : 'primary' }),
          'max-w-[82%] rounded-lg bg-app-surface-2/70 px-2.5 py-1.5',
          failed && 'ring-1 ring-app-danger/35',
        )}>
          {failed && <div className={typeStyle({ role: 'status', tone: 'danger' })}>{item.title}</div>}
          <div>{content ? formatInlineCodexText(content) : item.title}</div>
        </div>
      </div>
    )
  }

  return (
    <div data-turn-item={item.id} className="min-w-0">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          item.status === 'running' && 'animate-pulse motion-reduce:animate-none',
          item.status === 'failed' || item.status === 'declined' ? 'text-app-status-danger' : 'text-app-text-tertiary',
        )} />
        <div className="min-w-0 flex-1">
          <div className={cn(
            typeStyle({ role: 'body', tone: item.status === 'failed' || item.status === 'declined' ? 'danger' : 'secondary' }),
            'break-words',
          )}>
            {isNarrative && content ? formatInlineCodexText(content) : item.title}
          </div>
          {!isNarrative && item.detail && (
            <div className={cn(
              typeStyle({ role: item.kind === 'command' ? 'code' : 'metadata', tone: 'tertiary' }),
              'mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap break-all',
            )}>
              {item.detail}
            </div>
          )}
        </div>
      </div>
      {approvals.map((approval) => (
        <InlineApproval
          key={approval.id}
          approval={approval}
          resolving={Boolean(resolvingApprovalId)}
          onResolve={onResolveApproval}
        />
      ))}
    </div>
  )
}
