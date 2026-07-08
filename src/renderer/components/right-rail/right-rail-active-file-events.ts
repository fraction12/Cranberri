import type { GitFileStatus } from '@/shared/git'

export const RIGHT_RAIL_ACTIVE_FILE_EVENT = 'cranberri:right-rail-active-file'

interface RightRailActiveFileEventDetail {
  file: GitFileStatus | null
}

export function createRightRailActiveFileEvent(file: GitFileStatus | null): CustomEvent<RightRailActiveFileEventDetail> {
  return new CustomEvent(RIGHT_RAIL_ACTIVE_FILE_EVENT, { detail: { file } })
}

export function rightRailActiveFileFromEvent(event: Event): GitFileStatus | null {
  const file = (event as CustomEvent<Partial<RightRailActiveFileEventDetail>>).detail?.file
  if (file === null) return null
  if (!file?.path || !file.status) return null
  return file
}
