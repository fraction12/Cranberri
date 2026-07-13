import { Check, ExternalLink, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { buttonStyle, cn, fieldStyle } from '../../lib/ui'
import { typeStyle } from '../../lib/typography'
import type {
  CodexCommandExecutionApprovalDecision,
  CodexHumanServerRequestResponse,
  CodexJsonValue,
  CodexPendingHumanServerRequest,
  CodexRequestOutcomeEntry,
  CodexToolRequestUserInput,
} from '@/shared/codex-requests'

type Respond = (response: CodexHumanServerRequestResponse) => Promise<void>

function outcomeLabel(outcome: CodexRequestOutcomeEntry): string {
  const { kind, scope, count } = outcome.decision
  if (kind === 'accepted') return scope === 'session' ? 'Allowed for session' : 'Allowed once'
  if (kind === 'execpolicy_amendment') return `Allowed ${count} command ${count === 1 ? 'rule' : 'rules'}`
  if (kind === 'network_policy_amendment') return 'Network rule updated'
  if (kind === 'permissions_granted') return `${count} ${count === 1 ? 'permission' : 'permissions'} granted`
  if (kind === 'answered') return `${count} ${count === 1 ? 'answer' : 'answers'} sent`
  if (kind === 'declined') return 'Declined'
  if (kind === 'cancelled') return 'Cancelled'
  if (kind === 'external') return 'Resolved outside Cranberri'
  return 'Response failed'
}

export function InlineUserRequestOutcome({ outcome }: { outcome: CodexRequestOutcomeEntry }) {
  const failed = outcome.status === 'failed'
  const negative = failed || outcome.status === 'declined' || outcome.status === 'cancelled'
  const Icon = negative ? ShieldX : ShieldCheck
  return (
    <div
      data-human-request-outcome={`${typeof outcome.requestId}:${String(outcome.requestId)}`}
      className={cn(typeStyle({ role: 'status', tone: failed ? 'danger' : 'secondary' }), 'flex items-center gap-2 py-1')}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', negative ? 'text-app-status-warning' : 'text-app-status-success')} aria-hidden="true" />
      <span>{outcomeLabel(outcome)}</span>
    </div>
  )
}

function requestTitle(pending: CodexPendingHumanServerRequest): string {
  switch (pending.request.method) {
    case 'item/commandExecution/requestApproval': return 'Run this command?'
    case 'item/fileChange/requestApproval': return 'Apply these changes?'
    case 'item/permissions/requestApproval': return 'Allow additional access?'
    case 'item/tool/requestUserInput': return 'Codex needs your input'
    case 'mcpServer/elicitation/request': return `${pending.request.params.serverName} needs your input`
  }
}

function decisionLabel(decision: CodexCommandExecutionApprovalDecision): string {
  if (decision === 'accept') return 'Allow once'
  if (decision === 'acceptForSession') return 'Allow for session'
  if (decision === 'decline') return 'Decline'
  if (decision === 'cancel') return 'Cancel'
  if ('acceptWithExecpolicyAmendment' in decision) return 'Allow command rule'
  const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment
  return `${amendment.action === 'allow' ? 'Allow' : 'Block'} ${amendment.host}`
}

function isNegativeDecision(decision: CodexCommandExecutionApprovalDecision): boolean {
  return decision === 'decline' || decision === 'cancel'
}

export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseMcpFormContent(value: string): { value?: Exclude<CodexJsonValue, null>; error?: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null) return { error: 'Enter a JSON value.' }
    return { value: parsed as Exclude<CodexJsonValue, null> }
  } catch {
    return { error: 'Enter valid JSON.' }
  }
}

export function buildUserInputAnswers(
  request: CodexToolRequestUserInput,
  selected: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): { answers?: Record<string, { answers: string[] }>; error?: string } {
  const answers: Record<string, { answers: string[] }> = {}
  for (const question of request.params.questions) {
    const selection = selected[question.id]
    const raw = question.options
      ? selection === '__other__' ? values[question.id] ?? '' : selection ?? ''
      : values[question.id] ?? ''
    if (!raw.trim()) return { error: `Answer "${question.header}" before continuing.` }
    answers[question.id] = { answers: [raw] }
  }
  return { answers }
}

function RequestShell({
  pending,
  busy,
  sent,
  error,
  requestRef,
  children,
}: {
  pending: CodexPendingHumanServerRequest
  busy: boolean
  sent: boolean
  error: string | null
  children: React.ReactNode
  requestRef: React.RefObject<HTMLElement>
}) {
  const titleId = useId()
  return (
    <section
      ref={requestRef}
      data-human-request={`${typeof pending.request.id}:${String(pending.request.id)}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      tabIndex={-1}
      className="mt-2 rounded-md bg-app-surface/75 p-3 ring-1 ring-app-warning/35"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-app-status-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div id={titleId} className={typeStyle({ role: 'label' })}>{requestTitle(pending)}</div>
          <div className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'mt-0.5')}>
            Waiting for you
          </div>
        </div>
      </div>
      <div className="mt-3">{children}</div>
      <div aria-live="polite" className="mt-2 min-h-4">
        {sent && <div role="status" className={typeStyle({ role: 'status', tone: 'success' })}>Response sent</div>}
        {error && <div role="alert" className={typeStyle({ role: 'status', tone: 'danger' })}>{error}</div>}
      </div>
    </section>
  )
}

function Detail({ children, code = false }: { children: React.ReactNode; code?: boolean }) {
  return (
    <div className={cn(
      typeStyle({ role: code ? 'code' : 'body', tone: 'secondary' }),
      'mt-1 whitespace-pre-wrap break-words',
    )}>
      {children}
    </div>
  )
}

function ActionButton({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  danger?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={buttonStyle({ tone: danger ? 'ghost' : 'secondary', size: 'small' })}
    >
      {danger ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function InlineUserRequest({
  pending,
  onRespond,
}: {
  pending: CodexPendingHumanServerRequest
  onRespond?: Respond
}) {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({})
  const [answerValues, setAnswerValues] = useState<Record<string, string>>({})
  const [mcpContent, setMcpContent] = useState('{}')
  const requestRef = useRef<HTMLElement>(null)

  const showError = (message: string): void => {
    setError(message)
    requestAnimationFrame(() => requestRef.current?.focus())
  }

  const respond = async (response: CodexHumanServerRequestResponse): Promise<void> => {
    if (!onRespond || busy || sent) return
    setBusy(true)
    setError(null)
    try {
      await onRespond(response)
      setSent(true)
    } catch (responseError) {
      showError(responseError instanceof Error ? responseError.message : 'Could not send your response. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || sent || !onRespond
  const request = pending.request
  let content: React.ReactNode

  switch (request.method) {
    case 'item/commandExecution/requestApproval': {
      const decisions = request.params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel']
      content = (
        <>
          {request.params.reason && <Detail>{request.params.reason}</Detail>}
          {request.params.command && <Detail code>{request.params.command}</Detail>}
          {request.params.cwd && <div className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'mt-1')}>{request.params.cwd}</div>}
          {request.params.networkApprovalContext && (
            <Detail>{request.params.networkApprovalContext.protocol} access to {request.params.networkApprovalContext.host}</Detail>
          )}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Command approval choices">
            {decisions.map((decision) => (
              <ActionButton
                key={JSON.stringify(decision)}
                danger={isNegativeDecision(decision)}
                disabled={disabled}
                onClick={() => { void respond({ id: request.id, method: request.method, response: { decision } }) }}
              >
                {decisionLabel(decision)}
              </ActionButton>
            ))}
          </div>
        </>
      )
      break
    }
    case 'item/fileChange/requestApproval': {
      content = (
        <>
          {request.params.reason && <Detail>{request.params.reason}</Detail>}
          {request.params.grantRoot && <Detail code>{request.params.grantRoot}</Detail>}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="File change approval choices">
            {(['accept', 'acceptForSession', 'decline', 'cancel'] as const).map((decision) => (
              <ActionButton
                key={decision}
                danger={decision === 'decline' || decision === 'cancel'}
                disabled={disabled}
                onClick={() => { void respond({ id: request.id, method: request.method, response: { decision } }) }}
              >
                {decisionLabel(decision)}
              </ActionButton>
            ))}
          </div>
        </>
      )
      break
    }
    case 'item/permissions/requestApproval': {
      const permissions = request.params.permissions
      const permissionSummary = [
        permissions.network?.enabled ? 'Network access' : null,
        permissions.fileSystem?.read?.length ? `Read ${permissions.fileSystem.read.join(', ')}` : null,
        permissions.fileSystem?.write?.length ? `Write ${permissions.fileSystem.write.join(', ')}` : null,
        ...(permissions.fileSystem?.entries ?? []).map((entry) => `${entry.access} access`),
      ].filter(Boolean).join('; ')
      const granted = {
        ...(permissions.network ? { network: permissions.network } : {}),
        ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
      }
      content = (
        <>
          {request.params.reason && <Detail>{request.params.reason}</Detail>}
          <Detail>{permissionSummary || 'Additional permissions requested'}</Detail>
          <div className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'mt-1')}>{request.params.cwd}</div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Permission scope choices">
            <ActionButton disabled={disabled} onClick={() => { void respond({ id: request.id, method: request.method, response: { permissions: granted, scope: 'turn' } }) }}>Allow once</ActionButton>
            <ActionButton disabled={disabled} onClick={() => { void respond({ id: request.id, method: request.method, response: { permissions: granted, scope: 'session' } }) }}>Allow for session</ActionButton>
            <ActionButton danger disabled={disabled} onClick={() => { void respond({ id: request.id, method: request.method, response: { permissions: {}, scope: 'turn' } }) }}>Decline</ActionButton>
          </div>
        </>
      )
      break
    }
    case 'item/tool/requestUserInput': {
      const submitAnswers = (): void => {
        const result = buildUserInputAnswers(request, selectedAnswers, answerValues)
        if (!result.answers) {
          showError(result.error ?? 'Answer every question before continuing.')
          return
        }
        void respond({ id: request.id, method: request.method, response: { answers: result.answers } })
      }
      content = (
        <form onSubmit={(event) => { event.preventDefault(); submitAnswers() }}>
          <div className="space-y-4">
            {request.params.questions.map((question) => (
              <fieldset key={question.id} className="min-w-0">
                <legend className={typeStyle({ role: 'label' })}>{question.header}</legend>
                <div className={cn(typeStyle({ role: 'body', tone: 'secondary' }), 'mt-0.5')}>{question.question}</div>
                {question.options ? (
                  <div className="mt-2 space-y-1.5">
                    {question.options.map((option) => (
                      <label key={option.label} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-app-surface-2/55">
                        <input
                          type="radio"
                          name={`${String(request.id)}-${question.id}`}
                          checked={selectedAnswers[question.id] === option.label}
                          disabled={disabled}
                          onChange={() => setSelectedAnswers((current) => ({ ...current, [question.id]: option.label }))}
                          className="mt-1"
                        />
                        <span>
                          <span className={typeStyle({ role: 'control' })}>{option.label}</span>
                          <span className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'ml-2')}>{option.description}</span>
                        </span>
                      </label>
                    ))}
                    {question.isOther && (
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-surface-2/55">
                        <input
                          type="radio"
                          name={`${String(request.id)}-${question.id}`}
                          checked={selectedAnswers[question.id] === '__other__'}
                          disabled={disabled}
                          onChange={() => setSelectedAnswers((current) => ({ ...current, [question.id]: '__other__' }))}
                        />
                        <span className={typeStyle({ role: 'control' })}>Other</span>
                      </label>
                    )}
                  </div>
                ) : null}
                {(!question.options || selectedAnswers[question.id] === '__other__') && (
                  <input
                    type={question.isSecret ? 'password' : 'text'}
                    aria-label={question.question}
                    autoComplete="off"
                    value={answerValues[question.id] ?? ''}
                    disabled={disabled}
                    onChange={(event) => setAnswerValues((current) => ({ ...current, [question.id]: event.target.value }))}
                    className={cn(fieldStyle, 'mt-2 w-full')}
                  />
                )}
              </fieldset>
            ))}
          </div>
          {request.params.autoResolutionMs !== null && (
            <div className={cn(typeStyle({ role: 'metadata', tone: 'tertiary' }), 'mt-2')}>
              Codex may continue automatically if you do not answer.
            </div>
          )}
          <button type="submit" disabled={disabled} className={cn(buttonStyle({ tone: 'primary', size: 'small' }), 'mt-3')}>Submit answers</button>
        </form>
      )
      break
    }
    case 'mcpServer/elicitation/request': {
      const safeUrl = request.params.mode === 'url' ? safeExternalUrl(request.params.url) : null
      const accept = (): void => {
        if (request.params.mode === 'url') {
          void respond({
            id: request.id,
            method: request.method,
            response: { action: 'accept', content: { elicitationId: request.params.elicitationId }, _meta: request.params._meta },
          })
          return
        }
        const result = parseMcpFormContent(mcpContent)
        if (result.value === undefined) {
          showError(result.error ?? 'Enter valid JSON.')
          return
        }
        void respond({ id: request.id, method: request.method, response: { action: 'accept', content: result.value, _meta: request.params._meta } })
      }
      content = (
        <>
          <Detail>{request.params.message}</Detail>
          {request.params.mode === 'url' ? (
            safeUrl ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => { void window.cranberri.openExternal(safeUrl) }}
                className={cn(buttonStyle({ tone: 'secondary', size: 'small' }), 'mt-3')}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open secure page
              </button>
            ) : (
              <div role="alert" className={cn(typeStyle({ role: 'status', tone: 'danger' }), 'mt-2')}>This link cannot be opened safely.</div>
            )
          ) : (
            <textarea
              aria-label="Structured response as JSON"
              value={mcpContent}
              disabled={disabled}
              onChange={(event) => setMcpContent(event.target.value)}
              rows={4}
              className={cn(fieldStyle, typeStyle({ role: 'code' }), 'mt-2 h-auto w-full resize-y py-2')}
            />
          )}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Connected server request choices">
            {(request.params.mode !== 'url' || safeUrl) && <ActionButton disabled={disabled} onClick={accept}>{request.params.mode === 'url' ? 'Done' : 'Submit'}</ActionButton>}
            <ActionButton danger disabled={disabled} onClick={() => { void respond({ id: request.id, method: request.method, response: { action: 'decline', content: null, _meta: request.params._meta } }) }}>Decline</ActionButton>
            <ActionButton danger disabled={disabled} onClick={() => { void respond({ id: request.id, method: request.method, response: { action: 'cancel', content: null, _meta: request.params._meta } }) }}>Cancel</ActionButton>
          </div>
        </>
      )
      break
    }
  }

  return <RequestShell pending={pending} busy={busy} sent={sent} error={error} requestRef={requestRef}>{content}</RequestShell>
}
