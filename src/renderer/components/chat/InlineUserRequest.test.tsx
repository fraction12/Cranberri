import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CodexPendingHumanServerRequest } from '@/shared/codex-requests'
import {
  buildUserInputAnswers,
  InlineUserRequest,
  InlineUserRequestOutcome,
  parseMcpFormContent,
  safeExternalUrl,
} from './InlineUserRequest'

function pending(request: CodexPendingHumanServerRequest['request']): CodexPendingHumanServerRequest {
  return { request, attempt: 1, receivedAt: 100, deadlineAt: 10_000 }
}

describe('InlineUserRequest', () => {
  it('renders protocol-provided command choices including policy amendments', () => {
    const html = renderToStaticMarkup(<InlineUserRequest pending={pending({
      id: 'command-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        startedAtMs: 100,
        environmentId: null,
        reason: 'The command needs package access.',
        command: 'npm install example',
        cwd: '/repo',
        availableDecisions: [
          'accept',
          'acceptForSession',
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['npm', 'install'] } },
          { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'npmjs.org', action: 'allow' } } },
          'decline',
          'cancel',
        ],
      },
    })} onRespond={async () => undefined} />)

    expect(html).toContain('Run this command?')
    expect(html).toContain('npm install example')
    expect(html).toContain('Allow once')
    expect(html).toContain('Allow for session')
    expect(html).toContain('Allow command rule')
    expect(html).toContain('Allow npmjs.org')
    expect(html).toContain('Decline')
    expect(html).toContain('Cancel')
  })

  it('renders file and permission requests with session scope choices', () => {
    const fileHtml = renderToStaticMarkup(<InlineUserRequest pending={pending({
      id: 'file-1',
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-item', startedAtMs: 100, reason: 'Write generated files', grantRoot: '/repo' },
    })} onRespond={async () => undefined} />)
    const permissionsHtml = renderToStaticMarkup(<InlineUserRequest pending={pending({
      id: 'permissions-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'permission-item',
        environmentId: null,
        startedAtMs: 100,
        cwd: '/repo',
        reason: 'Read shared configuration',
        permissions: { network: { enabled: true }, fileSystem: { read: ['/shared'], write: null } },
      },
    })} onRespond={async () => undefined} />)

    expect(fileHtml).toContain('Apply these changes?')
    expect(fileHtml).toContain('Allow for session')
    expect(permissionsHtml).toContain('Allow additional access?')
    expect(permissionsHtml).toContain('Network access')
    expect(permissionsHtml).toContain('Read /shared')
    expect(permissionsHtml).toContain('Permission scope choices')
  })

  it('renders multiple option, free-text, and secret questions with accessible controls', () => {
    const request = {
      id: 'input-1',
      method: 'item/tool/requestUserInput' as const,
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item',
        autoResolutionMs: 60_000,
        questions: [{
          id: 'target',
          header: 'Target',
          question: 'Choose a target',
          isOther: true,
          isSecret: false,
          options: [{ label: 'Preview', description: 'Use preview' }],
        }, {
          id: 'notes',
          header: 'Notes',
          question: 'Add a note',
          isOther: false,
          isSecret: false,
          options: null,
        }, {
          id: 'token',
          header: 'Token',
          question: 'Enter the token',
          isOther: false,
          isSecret: true,
          options: null,
        }],
      },
    }
    const html = renderToStaticMarkup(<InlineUserRequest pending={pending(request)} onRespond={async () => undefined} />)

    expect(html).toContain('<fieldset')
    expect(html).toContain('Preview')
    expect(html).toContain('Other')
    expect(html).toContain('type="password"')
    expect(html).toContain('Codex may continue automatically')

    expect(buildUserInputAnswers(request, { target: 'Preview' }, { notes: 'Ship it', token: 'secret' })).toEqual({
      answers: {
        target: { answers: ['Preview'] },
        notes: { answers: ['Ship it'] },
        token: { answers: ['secret'] },
      },
    })
    expect(buildUserInputAnswers(request, { target: 'Preview' }, { notes: '', token: 'secret' }).error).toContain('Notes')
  })

  it('renders safe URL and form elicitation fallbacks without exposing metadata', () => {
    const urlHtml = renderToStaticMarkup(<InlineUserRequest pending={pending({
      id: 'mcp-url',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: null,
        serverName: 'GitHub',
        _meta: { secret: 'hidden' },
        message: 'Authorize GitHub',
        mode: 'url',
        url: 'https://github.com/login',
        elicitationId: 'elicit-1',
      },
    })} onRespond={async () => undefined} />)
    const formHtml = renderToStaticMarkup(<InlineUserRequest pending={pending({
      id: 'mcp-form',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        serverName: 'Deploy',
        _meta: null,
        message: 'Choose deployment settings',
        mode: 'form',
        requestedSchema: { type: 'object' },
      },
    })} onRespond={async () => undefined} />)

    expect(urlHtml).toContain('Open secure page')
    expect(urlHtml).not.toContain('&quot;secret&quot;')
    expect(formHtml).toContain('Structured response as JSON')
    expect(formHtml).toContain('Submit')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('https://example.com/auth')).toBe('https://example.com/auth')
    expect(parseMcpFormContent('{"target":"preview"}')).toEqual({ value: { target: 'preview' } })
    expect(parseMcpFormContent('not-json').error).toBe('Enter valid JSON.')
  })

  it('renders privacy-safe durable outcomes after the interactive request is gone', () => {
    const html = renderToStaticMarkup(<InlineUserRequestOutcome outcome={{
      requestId: 'request-1',
      method: 'item/commandExecution/requestApproval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      status: 'resolved',
      decision: { kind: 'accepted', scope: 'session', count: 1 },
      requestedAt: 100,
      completedAt: 200,
      attempt: 1,
    }} />)

    expect(html).toContain('data-human-request-outcome="string:request-1"')
    expect(html).toContain('Allowed for session')
    expect(html).not.toContain('commandExecution')
  })
})
