import simpleGit from 'simple-git'

export interface CommitMessage {
  title: string
  summary: string
}

export function normalizeManualCommitMessage(titleInput: string, summaryInput: string): CommitMessage {
  const title = titleInput.trim()
  const summary = summaryInput.trim()

  if (!title) throw new Error('Commit title is required')
  if (title.includes('\n')) throw new Error('Commit title must be one line')

  return { title, summary }
}

export async function commitRepo(repoPath: string, titleInput: string, summaryInput: string): Promise<CommitMessage & { hash: string }> {
  const git = simpleGit(repoPath)
  await git.add(['-A'])
  const diff = await git.diff(['--cached'])
  if (!diff.trim()) throw new Error('No changes to commit')

  const message = normalizeManualCommitMessage(titleInput, summaryInput)
  const args = message.summary ? { '--message': message.summary } : undefined
  const result = await git.commit(message.title, undefined, args)
  return { ...message, hash: result.commit }
}
