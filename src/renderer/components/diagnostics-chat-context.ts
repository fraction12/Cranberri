import type { CranberriDiagnosticsReport } from '@/shared/health'
import type { TelemetryEventRecord } from '@/shared/telemetry'

const MAX_DIAGNOSTICS_CONTEXT_CHARS = 14000
const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[-_]?key|credential)/i

function truncateMiddle(value: string, maxChars = MAX_DIAGNOSTICS_CONTEXT_CHARS): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  const keep = Math.floor((maxChars - 100) / 2)
  return [
    text.slice(0, keep).trimEnd(),
    '',
    `[Diagnostics context truncated: ${text.length - (keep * 2)} chars omitted from the middle]`,
    '',
    text.slice(-keep).trimStart(),
  ].join('\n')
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
    key,
    SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(item),
  ]))
}

function stringifyPayload(payload: unknown): string {
  try {
    const text = JSON.stringify(sanitize(payload))
    if (!text || text === '{}') return ''
    return text.length > 500 ? `${text.slice(0, 497)}...` : text
  } catch {
    return '[unserializable payload]'
  }
}

function formatEvent(event: TelemetryEventRecord): string {
  const payload = stringifyPayload(event.payload)
  return [
    `- #${event.id} ${event.timestamp} ${event.source}:${event.type}`,
    payload ? `  payload: ${payload}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function diagnosticsChatContext(report: CranberriDiagnosticsReport): string {
  const checks = report.health.checks.map((check) => [
    `- [${check.level}] ${check.label}: ${check.detail}`,
    check.fixAvailable ? '  fix available: yes' : null,
  ].filter((line): line is string => Boolean(line)).join('\n')).join('\n')

  const nativeHelpers = report.nativeHelpers.length
    ? report.nativeHelpers.map((helper) => [
      `- ${helper.label}: ${helper.availability}`,
      helper.detail ? `  detail: ${helper.detail}` : null,
    ].filter((line): line is string => Boolean(line)).join('\n')).join('\n')
    : 'No native helpers reported.'

  const recentEvents = report.recentEvents.length
    ? report.recentEvents.slice(0, 20).map(formatEvent).join('\n')
    : 'No recent telemetry events.'

  const body = [
    'Cranberri diagnostics context:',
    '',
    `Checked: ${new Date(report.checkedAt).toISOString()}`,
    `Health: ${report.health.level}`,
    '',
    'Build:',
    `Version: ${report.build.version}`,
    `Commit: ${report.build.commit}`,
    `Branch: ${report.build.branch}`,
    `Build time: ${report.build.buildTime}`,
    `Packaged: ${report.build.packaged}`,
    '',
    'Runtime:',
    `Platform: ${report.runtime.platform}/${report.runtime.arch}`,
    `Electron: ${report.runtime.electron}`,
    `Chrome: ${report.runtime.chrome}`,
    `Node: ${report.runtime.node}`,
    `Packaged runtime: ${report.runtime.packaged}`,
    '',
    'Paths:',
    `App: ${report.paths.app}`,
    `User data: ${report.paths.userData}`,
    `Resources: ${report.paths.resources}`,
    `Telemetry: ${report.paths.debugTelemetry}`,
    `Electron log: ${report.paths.electronLog ?? 'none'}`,
    `SQLite: ${report.paths.sqlite}`,
    '',
    'Health checks:',
    checks || 'No health checks reported.',
    '',
    'Native helpers:',
    nativeHelpers,
    '',
    'Recent events:',
    recentEvents,
  ].join('\n')

  return truncateMiddle(body)
}
