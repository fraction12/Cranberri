export const OPEN_RIGHT_RAIL_COMMAND_EVENT = 'cranberri:open-right-rail-command'

export type RightRailCommandTab = 'files' | 'diff'
export type RightRailCommandBottomPanel = 'issue' | 'processes' | 'github' | 'tools'
export type RightRailCommandFilesMode = 'changes' | 'all'
export type RightRailSelectedFileCommand = 'search' | 'go-to-line' | 'send-context' | 'copy-path' | 'copy-content'
export type RightRailCommandAction = 'open-commit' | 'open-commit-draft'

export interface RightRailCommand {
  tab?: RightRailCommandTab
  bottomPanel?: RightRailCommandBottomPanel | null
  filesMode?: RightRailCommandFilesMode
  selectedFileCommand?: RightRailSelectedFileCommand
  selectedFileLine?: number
  action?: RightRailCommandAction
}

export function createOpenRightRailCommandEvent(command: RightRailCommand): CustomEvent<RightRailCommand> {
  return new CustomEvent(OPEN_RIGHT_RAIL_COMMAND_EVENT, { detail: command })
}

export function rightRailCommandFromEvent(event: Event): RightRailCommand | null {
  const detail = (event as CustomEvent<Partial<RightRailCommand>>).detail
  if (!detail || typeof detail !== 'object') return null
  const command: RightRailCommand = {}
  if (detail.tab === 'files' || detail.tab === 'diff') command.tab = detail.tab
  if (detail.filesMode === 'changes' || detail.filesMode === 'all') command.filesMode = detail.filesMode
  if (
    detail.selectedFileCommand === 'search' ||
    detail.selectedFileCommand === 'go-to-line' ||
    detail.selectedFileCommand === 'send-context' ||
    detail.selectedFileCommand === 'copy-path' ||
    detail.selectedFileCommand === 'copy-content'
  ) {
    command.selectedFileCommand = detail.selectedFileCommand
  }
  if (typeof detail.selectedFileLine === 'number' && Number.isFinite(detail.selectedFileLine) && detail.selectedFileLine > 0) {
    command.selectedFileLine = Math.floor(detail.selectedFileLine)
  }
  if (detail.action === 'open-commit' || detail.action === 'open-commit-draft') command.action = detail.action
  if (
    detail.bottomPanel === null ||
    detail.bottomPanel === 'issue' ||
    detail.bottomPanel === 'processes' ||
    detail.bottomPanel === 'github' ||
    detail.bottomPanel === 'tools'
  ) {
    command.bottomPanel = detail.bottomPanel
  }
  return Object.keys(command).length > 0 ? command : null
}
