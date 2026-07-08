import type { GitFileStatus } from '@/shared/git'

export const OPEN_RIGHT_RAIL_FILE_EVENT = 'cranberri:open-right-rail-file'

interface RightRailFileEventDetail {
  file: GitFileStatus
  line?: number
}

export interface RightRailFileOpenRequest {
  file: GitFileStatus
  line?: number
}

export function createOpenRightRailFileEvent(file: GitFileStatus, line?: number): CustomEvent<RightRailFileEventDetail> {
  return new CustomEvent(OPEN_RIGHT_RAIL_FILE_EVENT, { detail: { file, line } })
}

export function rightRailFileFromEvent(event: Event): RightRailFileOpenRequest | null {
  const detail = (event as CustomEvent<Partial<RightRailFileEventDetail>>).detail
  const file = detail?.file
  if (!file?.path || !file.status) return null
  return { file, line: typeof detail?.line === 'number' && detail.line > 0 ? detail.line : undefined }
}
