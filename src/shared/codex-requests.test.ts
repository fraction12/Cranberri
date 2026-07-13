import { describe, expect, it } from 'vitest'
import {
  codexCommandExecutionApprovalDecisionSchema,
  codexCommandExecutionRequestApprovalResponseSchema,
  codexFileChangeApprovalDecisionSchema,
  codexFileChangeRequestApprovalResponseSchema,
  codexHumanServerRequestResponseSchema,
  codexHumanServerRequestSchema,
  codexMcpServerElicitationRequestResponseSchema,
  codexPermissionsRequestApprovalResponseSchema,
  codexServerRequestsListInputSchema,
  codexServerRequestsSnapshotSchema,
  codexToolRequestUserInputResponseSchema,
} from './codex-requests'

const commandRequest = {
  id: 'request-command-1',
  method: 'item/commandExecution/requestApproval',
  params: {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-command-1',
    startedAtMs: 1_720_000_000_000,
    approvalId: 'approval-1',
    environmentId: 'local',
    reason: 'Needs network access',
    networkApprovalContext: { host: 'api.example.com', protocol: 'https' },
    command: 'curl https://api.example.com',
    cwd: '/repo',
    commandActions: [
      { type: 'search', command: 'rg parity src', query: 'parity', path: 'src' },
      { type: 'read', command: 'cat package.json', name: 'package.json', path: '/repo/package.json' },
    ],
    additionalPermissions: {
      network: { enabled: true },
      fileSystem: {
        read: ['/repo'],
        write: ['/repo/tmp'],
        globScanMaxDepth: 4,
        entries: [
          { path: { type: 'path', path: '/repo' }, access: 'read' },
          { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'write' },
        ],
      },
    },
    proposedExecpolicyAmendment: ['prefix_rule', 'curl'],
    proposedNetworkPolicyAmendments: [
      { host: 'api.example.com', action: 'allow' },
      { host: 'blocked.example.com', action: 'deny' },
    ],
    availableDecisions: [
      'accept',
      'acceptForSession',
      { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['prefix_rule', 'curl'] } },
      { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'api.example.com', action: 'allow' } } },
      'decline',
      'cancel',
    ],
  },
} as const

describe('codexHumanServerRequestSchema', () => {
  it('preserves the full command approval request and every decision variant', () => {
    expect(codexHumanServerRequestSchema.parse(commandRequest)).toEqual(commandRequest)

    for (const decision of commandRequest.params.availableDecisions) {
      expect(codexCommandExecutionApprovalDecisionSchema.safeParse(decision).success).toBe(true)
    }
  })

  it('accepts numeric request ids and preserves file and permission approval fields', () => {
    const fileRequest = {
      id: 42,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-file-1',
        startedAtMs: 1_720_000_000_100,
        reason: 'Write outside the workspace',
        grantRoot: '/shared',
      },
    } as const
    const permissionsRequest = {
      id: 'request-permissions-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-permissions-1',
        environmentId: null,
        startedAtMs: 1_720_000_000_200,
        cwd: '/repo',
        reason: null,
        permissions: {
          network: { enabled: null },
          fileSystem: {
            read: null,
            write: null,
            entries: [
              { path: { type: 'glob_pattern', pattern: '/repo/**/*.ts' }, access: 'read' },
              {
                path: { type: 'special', value: { kind: 'project_roots', subpath: 'src' } },
                access: 'write',
              },
            ],
          },
        },
      },
    } as const

    expect(codexHumanServerRequestSchema.parse(fileRequest)).toEqual(fileRequest)
    expect(codexHumanServerRequestSchema.parse(permissionsRequest)).toEqual(permissionsRequest)
    for (const decision of ['accept', 'acceptForSession', 'decline', 'cancel']) {
      expect(codexFileChangeApprovalDecisionSchema.safeParse(decision).success).toBe(true)
    }
  })

  it('preserves structured user-input questions, options, secrets, and auto-resolution', () => {
    const request = {
      id: 'request-input-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-tool-1',
        questions: [
          {
            id: 'deployment',
            header: 'Deploy',
            question: 'Choose a deployment target',
            isOther: true,
            isSecret: false,
            options: [
              { label: 'Preview', description: 'Deploy to the preview environment' },
              { label: 'Production', description: 'Deploy to production' },
            ],
          },
          {
            id: 'token',
            header: 'Token',
            question: 'Enter the one-time token',
            isOther: false,
            isSecret: true,
            options: null,
          },
        ],
        autoResolutionMs: 120_000,
      },
    } as const

    expect(codexHumanServerRequestSchema.parse(request)).toEqual(request)
  })

  it.each([
    {
      mode: 'form',
      _meta: { request: { source: 'github' } },
      message: 'Choose repository settings',
      requestedSchema: {
        type: 'object',
        properties: {
          visibility: { type: 'string', enum: ['private', 'public'] },
          retries: { type: 'integer', minimum: 0 },
        },
        required: ['visibility'],
      },
    },
    {
      mode: 'openai/form',
      _meta: null,
      message: 'Complete the hosted form',
      requestedSchema: {
        type: 'object',
        layout: [{ field: 'email', width: 12 }],
        properties: { email: { type: 'string', format: 'email' } },
      },
    },
    {
      mode: 'url',
      _meta: { browser: { external: true } },
      message: 'Authorize access',
      url: 'https://example.com/authorize',
      elicitationId: 'elicitation-1',
    },
  ])('preserves MCP $mode payloads as structured JSON', (payload) => {
    const request = {
      id: 'request-mcp-1',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: null,
        serverName: 'github',
        ...payload,
      },
    }

    expect(codexHumanServerRequestSchema.parse(request)).toEqual(request)
  })

  it('rejects unknown fields and method/params mismatches', () => {
    expect(codexHumanServerRequestSchema.safeParse({ ...commandRequest, unexpected: true }).success).toBe(false)
    expect(codexHumanServerRequestSchema.safeParse({
      ...commandRequest,
      params: { ...commandRequest.params, unexpected: true },
    }).success).toBe(false)
    expect(codexHumanServerRequestSchema.safeParse({
      ...commandRequest,
      method: 'item/fileChange/requestApproval',
    }).success).toBe(false)
    expect(codexHumanServerRequestSchema.safeParse({
      ...commandRequest,
      method: 'thread/approveGuardianDeniedAction',
    }).success).toBe(false)
  })
})

describe('Codex human server request responses', () => {
  it('parses strict command and file decision responses', () => {
    expect(codexCommandExecutionRequestApprovalResponseSchema.parse({
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['prefix_rule', 'npm', 'test'] } },
    })).toEqual({
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['prefix_rule', 'npm', 'test'] } },
    })
    expect(codexCommandExecutionRequestApprovalResponseSchema.parse({
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'npmjs.org', action: 'allow' } } },
    })).toEqual({
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'npmjs.org', action: 'allow' } } },
    })
    expect(codexFileChangeRequestApprovalResponseSchema.parse({ decision: 'acceptForSession' })).toEqual({
      decision: 'acceptForSession',
    })
  })

  it('parses permission grants, user-input answers, and MCP outcomes', () => {
    expect(codexPermissionsRequestApprovalResponseSchema.parse({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/repo'], write: null },
      },
      scope: 'session',
      strictAutoReview: true,
    })).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['/repo'], write: null },
      },
      scope: 'session',
      strictAutoReview: true,
    })
    expect(codexToolRequestUserInputResponseSchema.parse({
      answers: {
        deployment: { answers: ['Preview'] },
        notes: { answers: ['Keep the current cache', 'Run smoke tests'] },
      },
    })).toEqual({
      answers: {
        deployment: { answers: ['Preview'] },
        notes: { answers: ['Keep the current cache', 'Run smoke tests'] },
      },
    })

    expect(codexMcpServerElicitationRequestResponseSchema.parse({
      action: 'accept',
      content: { repository: 'Cranberri', settings: { private: true } },
      _meta: { submittedBy: 'operator' },
    })).toEqual({
      action: 'accept',
      content: { repository: 'Cranberri', settings: { private: true } },
      _meta: { submittedBy: 'operator' },
    })
    expect(codexMcpServerElicitationRequestResponseSchema.parse({ action: 'decline', content: null, _meta: null })).toEqual({
      action: 'decline',
      content: null,
      _meta: null,
    })
    expect(codexMcpServerElicitationRequestResponseSchema.parse({ action: 'cancel', content: null, _meta: null })).toEqual({
      action: 'cancel',
      content: null,
      _meta: null,
    })
  })

  it('rejects invalid method/response combinations and malformed outcomes', () => {
    expect(codexHumanServerRequestResponseSchema.safeParse({
      id: 'request-file-1',
      method: 'item/fileChange/requestApproval',
      response: { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'x', action: 'allow' } } } },
    }).success).toBe(false)
    expect(codexHumanServerRequestResponseSchema.safeParse({
      id: 'request-command-1',
      method: 'item/commandExecution/requestApproval',
      response: { decision: 'accept', unexpected: true },
    }).success).toBe(false)
    expect(codexMcpServerElicitationRequestResponseSchema.safeParse({
      action: 'decline',
      content: { ignored: true },
      _meta: null,
    }).success).toBe(false)
    expect(codexMcpServerElicitationRequestResponseSchema.safeParse({
      action: 'accept',
      content: { invalid: undefined },
      _meta: null,
    }).success).toBe(false)
  })
})

describe('Codex human server request IPC', () => {
  it('strictly validates list inputs and display-safe snapshots', () => {
    expect(codexServerRequestsListInputSchema.parse({ threadId: 'thread-1' })).toEqual({ threadId: 'thread-1' })
    expect(codexServerRequestsListInputSchema.safeParse({ threadId: 'thread-1', extra: true }).success).toBe(false)
    expect(codexServerRequestsSnapshotSchema.parse({
      pending: [],
      outcomes: [{
        requestId: 'request-1',
        method: 'item/commandExecution/requestApproval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        status: 'resolved',
        decision: { kind: 'accepted', scope: 'request', count: 1 },
        requestedAt: 100,
        completedAt: 200,
        attempt: 1,
      }],
    }).outcomes).toHaveLength(1)
  })
})
