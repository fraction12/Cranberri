import { useCallback } from 'react'
import { toast } from 'sonner'
import type { CodexSessionSummary, CodexThread, CodexWorker } from '@/shared/codex'
import { useCodexActions, useCodexThreads } from '../../state/codex'
import { useRepos } from '../../state/repos'
import { AgentList, agentDisplayName } from './AgentList'

export function AgentsPanel({ thread }: { thread: CodexThread | null }) {
  const { getThread } = useCodexThreads()
  const { messageWorker, stopWorker } = useCodexActions()
  const { repos, activeRepo } = useRepos()
  const threadRepo = repos.find((repo) => repo.id === thread?.repoId) ?? activeRepo

  const openCodexThread = useCallback((session: CodexSessionSummary) => {
    if (!threadRepo) {
      toast.error('This task\'s repository is no longer available.')
      return
    }
    window.dispatchEvent(new CustomEvent('cranberri:open-codex-session', {
      detail: { session, repoPath: threadRepo.path, archived: false },
    }))
  }, [threadRepo])

  const openAgent = useCallback((agent: CodexWorker) => {
    openCodexThread({
      id: agent.threadId,
      sessionId: agent.sessionId,
      parentThreadId: agent.parentThreadId,
      agentNickname: agent.nickname,
      agentRole: agent.role,
      title: agent.title || agentDisplayName(agent),
      preview: agent.prompt || agent.lastInstruction || '',
      cwd: agent.cwd ?? threadRepo?.path,
      createdAt: agent.createdAt ?? agent.updatedAt,
      updatedAt: agent.updatedAt,
      archived: false,
      status: agent.status,
      turnCount: 0,
    })
  }, [openCodexThread, threadRepo?.path])

  const openParent = useCallback((parentThreadId: string) => {
    const parent = getThread(parentThreadId)
    openCodexThread({
      id: parentThreadId,
      title: parent?.title ?? 'Parent task',
      preview: '',
      cwd: threadRepo?.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      turnCount: 0,
    })
  }, [getThread, openCodexThread, threadRepo?.path])

  return (
    <AgentList
      thread={thread}
      onOpenAgent={openAgent}
      onOpenParent={openParent}
      onMessageAgent={(agent, content) => thread
        ? messageWorker(thread.id, agent.threadId, content)
        : Promise.reject(new Error('No active task'))}
      onStopAgent={(agent) => thread
        ? stopWorker(thread.id, agent.threadId)
        : Promise.reject(new Error('No active task'))}
    />
  )
}
