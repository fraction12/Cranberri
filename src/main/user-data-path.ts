import path from 'node:path'
import type { BuildChannel } from '../shared/buildInfo'

interface ResolveUserDataPathInput {
  appDataPath: string
  channel: BuildChannel
  commit: string
  explicitPath: string | undefined
  taskStoreVersion: number
  tempPath: string
}

export function resolveUserDataPath(input: ResolveUserDataPathInput): string | null {
  if (input.explicitPath) return input.explicitPath
  const schemaDirectory = `task-store-v${input.taskStoreVersion}`
  if (input.channel === 'development') {
    return path.join(input.appDataPath, 'Cranberri Development', schemaDirectory)
  }
  if (input.channel === 'uat') {
    const buildId = input.commit === 'unknown' ? 'unknown' : input.commit.slice(0, 12)
    return path.join(input.tempPath, 'cranberri-uat', buildId, schemaDirectory)
  }
  return null
}
