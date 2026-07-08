const ESC = String.fromCharCode(27)
const CSI = String.fromCharCode(155)
const BEL = String.fromCharCode(7)

const ANSI_PATTERN = new RegExp(
  `[${ESC}${CSI}][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?${BEL})|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))`,
  'g',
)

export function stripTerminalControlSequences(value: string): string {
  return value.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function terminalClipboardText(renderedBuffer: string, snapshotBuffer: string): string {
  const rendered = renderedBuffer.trim()
  const snapshot = stripTerminalControlSequences(snapshotBuffer).trim()
  return snapshot.length > rendered.length ? snapshot : rendered
}
