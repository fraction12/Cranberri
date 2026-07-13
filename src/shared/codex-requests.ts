import { z } from 'zod'

export type CodexJsonValue =
  | string
  | number
  | boolean
  | null
  | CodexJsonValue[]
  | { [key: string]: CodexJsonValue }

export const codexJsonValueSchema: z.ZodType<CodexJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(codexJsonValueSchema),
  z.record(z.string(), codexJsonValueSchema),
]))

export const codexJsonObjectSchema = z.record(z.string(), codexJsonValueSchema)
export type CodexJsonObject = z.infer<typeof codexJsonObjectSchema>

const codexNonNullJsonValueSchema: z.ZodType<Exclude<CodexJsonValue, null>> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(codexJsonValueSchema),
  z.record(z.string(), codexJsonValueSchema),
]))

export const codexRequestIdSchema = z.union([z.string(), z.number()])
export type CodexRequestId = z.infer<typeof codexRequestIdSchema>

const codexNetworkPolicyAmendmentSchema = z.object({
  host: z.string(),
  action: z.enum(['allow', 'deny']),
}).strict()
export type CodexNetworkPolicyAmendment = z.infer<typeof codexNetworkPolicyAmendmentSchema>

const codexFileSystemSpecialPathSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('root') }).strict(),
  z.object({ kind: z.literal('minimal') }).strict(),
  z.object({
    kind: z.literal('project_roots'),
    subpath: z.string().nullable(),
  }).strict(),
  z.object({ kind: z.literal('tmpdir') }).strict(),
  z.object({ kind: z.literal('slash_tmp') }).strict(),
  z.object({
    kind: z.literal('unknown'),
    path: z.string(),
    subpath: z.string().nullable(),
  }).strict(),
])

const codexFileSystemPathSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('path'),
    path: z.string(),
  }).strict(),
  z.object({
    type: z.literal('glob_pattern'),
    pattern: z.string(),
  }).strict(),
  z.object({
    type: z.literal('special'),
    value: codexFileSystemSpecialPathSchema,
  }).strict(),
])

const codexAdditionalFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()).nullable(),
  write: z.array(z.string()).nullable(),
  globScanMaxDepth: z.number().int().nonnegative().optional(),
  entries: z.array(z.object({
    path: codexFileSystemPathSchema,
    access: z.enum(['read', 'write', 'deny']),
  }).strict()).optional(),
}).strict()
export type CodexAdditionalFileSystemPermissions = z.infer<typeof codexAdditionalFileSystemPermissionsSchema>

const codexAdditionalNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
}).strict()
export type CodexAdditionalNetworkPermissions = z.infer<typeof codexAdditionalNetworkPermissionsSchema>

export const codexAdditionalPermissionProfileSchema = z.object({
  network: codexAdditionalNetworkPermissionsSchema.nullable(),
  fileSystem: codexAdditionalFileSystemPermissionsSchema.nullable(),
}).strict()
export type CodexAdditionalPermissionProfile = z.infer<typeof codexAdditionalPermissionProfileSchema>

export const codexGrantedPermissionProfileSchema = z.object({
  network: codexAdditionalNetworkPermissionsSchema.optional(),
  fileSystem: codexAdditionalFileSystemPermissionsSchema.optional(),
}).strict()
export type CodexGrantedPermissionProfile = z.infer<typeof codexGrantedPermissionProfileSchema>

export const codexCommandExecutionApprovalDecisionSchema = z.union([
  z.enum(['accept', 'acceptForSession']),
  z.object({
    acceptWithExecpolicyAmendment: z.object({
      execpolicy_amendment: z.array(z.string()),
    }).strict(),
  }).strict(),
  z.object({
    applyNetworkPolicyAmendment: z.object({
      network_policy_amendment: codexNetworkPolicyAmendmentSchema,
    }).strict(),
  }).strict(),
  z.enum(['decline', 'cancel']),
])
export type CodexCommandExecutionApprovalDecision = z.infer<typeof codexCommandExecutionApprovalDecisionSchema>

const codexCommandActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('read'),
    command: z.string(),
    name: z.string(),
    path: z.string(),
  }).strict(),
  z.object({
    type: z.literal('listFiles'),
    command: z.string(),
    path: z.string().nullable(),
  }).strict(),
  z.object({
    type: z.literal('search'),
    command: z.string(),
    query: z.string().nullable(),
    path: z.string().nullable(),
  }).strict(),
  z.object({
    type: z.literal('unknown'),
    command: z.string(),
  }).strict(),
])
export type CodexCommandAction = z.infer<typeof codexCommandActionSchema>

export const codexCommandExecutionRequestApprovalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  startedAtMs: z.number().int().nonnegative(),
  approvalId: z.string().nullable().optional(),
  environmentId: z.string().nullable(),
  reason: z.string().nullable().optional(),
  networkApprovalContext: z.object({
    host: z.string(),
    protocol: z.enum(['http', 'https', 'socks5Tcp', 'socks5Udp']),
  }).strict().nullable().optional(),
  command: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  commandActions: z.array(codexCommandActionSchema).nullable().optional(),
  additionalPermissions: codexAdditionalPermissionProfileSchema.nullable().optional(),
  proposedExecpolicyAmendment: z.array(z.string()).nullable().optional(),
  proposedNetworkPolicyAmendments: z.array(codexNetworkPolicyAmendmentSchema).nullable().optional(),
  availableDecisions: z.array(codexCommandExecutionApprovalDecisionSchema).nullable().optional(),
}).strict()
export type CodexCommandExecutionRequestApprovalParams = z.infer<typeof codexCommandExecutionRequestApprovalParamsSchema>

export const codexCommandExecutionRequestApprovalSchema = z.object({
  id: codexRequestIdSchema,
  method: z.literal('item/commandExecution/requestApproval'),
  params: codexCommandExecutionRequestApprovalParamsSchema,
}).strict()
export type CodexCommandExecutionRequestApproval = z.infer<typeof codexCommandExecutionRequestApprovalSchema>

export const codexFileChangeApprovalDecisionSchema = z.enum([
  'accept',
  'acceptForSession',
  'decline',
  'cancel',
])
export type CodexFileChangeApprovalDecision = z.infer<typeof codexFileChangeApprovalDecisionSchema>

export const codexFileChangeRequestApprovalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  startedAtMs: z.number().int().nonnegative(),
  reason: z.string().nullable().optional(),
  grantRoot: z.string().nullable().optional(),
}).strict()
export type CodexFileChangeRequestApprovalParams = z.infer<typeof codexFileChangeRequestApprovalParamsSchema>

export const codexFileChangeRequestApprovalSchema = z.object({
  id: codexRequestIdSchema,
  method: z.literal('item/fileChange/requestApproval'),
  params: codexFileChangeRequestApprovalParamsSchema,
}).strict()
export type CodexFileChangeRequestApproval = z.infer<typeof codexFileChangeRequestApprovalSchema>

export const codexRequestPermissionProfileSchema = z.object({
  network: codexAdditionalNetworkPermissionsSchema.nullable(),
  fileSystem: codexAdditionalFileSystemPermissionsSchema.nullable(),
}).strict()
export type CodexRequestPermissionProfile = z.infer<typeof codexRequestPermissionProfileSchema>

export const codexPermissionsRequestApprovalParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  environmentId: z.string().nullable(),
  startedAtMs: z.number().int().nonnegative(),
  cwd: z.string(),
  reason: z.string().nullable(),
  permissions: codexRequestPermissionProfileSchema,
}).strict()
export type CodexPermissionsRequestApprovalParams = z.infer<typeof codexPermissionsRequestApprovalParamsSchema>

export const codexPermissionsRequestApprovalSchema = z.object({
  id: codexRequestIdSchema,
  method: z.literal('item/permissions/requestApproval'),
  params: codexPermissionsRequestApprovalParamsSchema,
}).strict()
export type CodexPermissionsRequestApproval = z.infer<typeof codexPermissionsRequestApprovalSchema>

export const codexToolRequestUserInputOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
}).strict()
export type CodexToolRequestUserInputOption = z.infer<typeof codexToolRequestUserInputOptionSchema>

export const codexToolRequestUserInputQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  isOther: z.boolean(),
  isSecret: z.boolean(),
  options: z.array(codexToolRequestUserInputOptionSchema).nullable(),
}).strict()
export type CodexToolRequestUserInputQuestion = z.infer<typeof codexToolRequestUserInputQuestionSchema>

export const codexToolRequestUserInputParamsSchema = z.object({
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  questions: z.array(codexToolRequestUserInputQuestionSchema),
  autoResolutionMs: z.number().int().nonnegative().nullable(),
}).strict()
export type CodexToolRequestUserInputParams = z.infer<typeof codexToolRequestUserInputParamsSchema>

export const codexToolRequestUserInputSchema = z.object({
  id: codexRequestIdSchema,
  method: z.literal('item/tool/requestUserInput'),
  params: codexToolRequestUserInputParamsSchema,
}).strict()
export type CodexToolRequestUserInput = z.infer<typeof codexToolRequestUserInputSchema>

const codexMcpElicitationBaseParamsShape = {
  threadId: z.string(),
  turnId: z.string().nullable(),
  serverName: z.string(),
  _meta: codexJsonValueSchema,
  message: z.string(),
}

export const codexMcpServerElicitationRequestParamsSchema = z.discriminatedUnion('mode', [
  z.object({
    ...codexMcpElicitationBaseParamsShape,
    mode: z.literal('form'),
    requestedSchema: codexJsonObjectSchema,
  }).strict(),
  z.object({
    ...codexMcpElicitationBaseParamsShape,
    mode: z.literal('openai/form'),
    requestedSchema: codexJsonValueSchema,
  }).strict(),
  z.object({
    ...codexMcpElicitationBaseParamsShape,
    mode: z.literal('url'),
    url: z.string(),
    elicitationId: z.string(),
  }).strict(),
])
export type CodexMcpServerElicitationRequestParams = z.infer<typeof codexMcpServerElicitationRequestParamsSchema>

export const codexMcpServerElicitationRequestSchema = z.object({
  id: codexRequestIdSchema,
  method: z.literal('mcpServer/elicitation/request'),
  params: codexMcpServerElicitationRequestParamsSchema,
}).strict()
export type CodexMcpServerElicitationRequest = z.infer<typeof codexMcpServerElicitationRequestSchema>

export const codexHumanServerRequestSchema = z.discriminatedUnion('method', [
  codexCommandExecutionRequestApprovalSchema,
  codexFileChangeRequestApprovalSchema,
  codexPermissionsRequestApprovalSchema,
  codexToolRequestUserInputSchema,
  codexMcpServerElicitationRequestSchema,
])
export type CodexHumanServerRequest = z.infer<typeof codexHumanServerRequestSchema>

export const codexPendingHumanServerRequestSchema = z.object({
  request: codexHumanServerRequestSchema,
  attempt: z.number().int().positive(),
  receivedAt: z.number().int().nonnegative(),
  deadlineAt: z.number().int().nonnegative(),
}).strict()
export type CodexPendingHumanServerRequest = z.infer<typeof codexPendingHumanServerRequestSchema>

export const codexRequestOutcomeEntrySchema = z.object({
  requestId: z.union([z.string().min(1).max(512), z.number().finite()]),
  method: z.enum([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
  ]),
  threadId: z.string().min(1).max(512),
  turnId: z.string().min(1).max(512).nullable(),
  itemId: z.string().min(1).max(512).nullable(),
  status: z.enum(['resolved', 'declined', 'cancelled', 'failed', 'external']),
  decision: z.object({
    kind: z.enum([
      'accepted',
      'execpolicy_amendment',
      'network_policy_amendment',
      'permissions_granted',
      'answered',
      'declined',
      'cancelled',
      'failed',
      'external',
    ]),
    scope: z.enum(['request', 'turn', 'session']).nullable(),
    count: z.number().int().nonnegative(),
  }).strict(),
  requestedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
}).strict().superRefine((entry, context) => {
  const terminalKinds = new Set(['declined', 'cancelled', 'failed', 'external'])
  const isConsistent = entry.status === 'resolved'
    ? !terminalKinds.has(entry.decision.kind)
    : entry.status === entry.decision.kind
  if (!isConsistent) {
    context.addIssue({
      code: 'custom',
      path: ['decision', 'kind'],
      message: 'Decision kind does not match request outcome status',
    })
  }
})
export type CodexRequestOutcomeEntry = z.infer<typeof codexRequestOutcomeEntrySchema>

export const codexServerRequestsListInputSchema = z.object({
  threadId: z.string().min(1).max(512).optional(),
}).strict()
export type CodexServerRequestsListInput = z.infer<typeof codexServerRequestsListInputSchema>

export const codexServerRequestsSnapshotSchema = z.object({
  pending: z.array(codexPendingHumanServerRequestSchema),
  outcomes: z.array(codexRequestOutcomeEntrySchema),
}).strict()
export type CodexServerRequestsSnapshot = z.infer<typeof codexServerRequestsSnapshotSchema>

export const codexCommandExecutionRequestApprovalResponseSchema = z.object({
  decision: codexCommandExecutionApprovalDecisionSchema,
}).strict()
export type CodexCommandExecutionRequestApprovalResponse = z.infer<typeof codexCommandExecutionRequestApprovalResponseSchema>

export const codexFileChangeRequestApprovalResponseSchema = z.object({
  decision: codexFileChangeApprovalDecisionSchema,
}).strict()
export type CodexFileChangeRequestApprovalResponse = z.infer<typeof codexFileChangeRequestApprovalResponseSchema>

export const codexPermissionsRequestApprovalResponseSchema = z.object({
  permissions: codexGrantedPermissionProfileSchema,
  scope: z.enum(['turn', 'session']),
  strictAutoReview: z.boolean().optional(),
}).strict()
export type CodexPermissionsRequestApprovalResponse = z.infer<typeof codexPermissionsRequestApprovalResponseSchema>

export const codexToolRequestUserInputAnswerSchema = z.object({
  answers: z.array(z.string()),
}).strict()
export type CodexToolRequestUserInputAnswer = z.infer<typeof codexToolRequestUserInputAnswerSchema>

export const codexToolRequestUserInputResponseSchema = z.object({
  answers: z.record(z.string(), codexToolRequestUserInputAnswerSchema),
}).strict()
export type CodexToolRequestUserInputResponse = z.infer<typeof codexToolRequestUserInputResponseSchema>

const codexMcpResponseMetaSchema = codexJsonValueSchema

export const codexMcpServerElicitationRequestResponseSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept'),
    content: codexNonNullJsonValueSchema,
    _meta: codexMcpResponseMetaSchema,
  }).strict(),
  z.object({
    action: z.literal('decline'),
    content: z.null(),
    _meta: codexMcpResponseMetaSchema,
  }).strict(),
  z.object({
    action: z.literal('cancel'),
    content: z.null(),
    _meta: codexMcpResponseMetaSchema,
  }).strict(),
])
export type CodexMcpServerElicitationRequestResponse = z.infer<typeof codexMcpServerElicitationRequestResponseSchema>

export const codexHumanServerRequestResponseSchema = z.discriminatedUnion('method', [
  z.object({
    id: codexRequestIdSchema,
    method: z.literal('item/commandExecution/requestApproval'),
    response: codexCommandExecutionRequestApprovalResponseSchema,
  }).strict(),
  z.object({
    id: codexRequestIdSchema,
    method: z.literal('item/fileChange/requestApproval'),
    response: codexFileChangeRequestApprovalResponseSchema,
  }).strict(),
  z.object({
    id: codexRequestIdSchema,
    method: z.literal('item/permissions/requestApproval'),
    response: codexPermissionsRequestApprovalResponseSchema,
  }).strict(),
  z.object({
    id: codexRequestIdSchema,
    method: z.literal('item/tool/requestUserInput'),
    response: codexToolRequestUserInputResponseSchema,
  }).strict(),
  z.object({
    id: codexRequestIdSchema,
    method: z.literal('mcpServer/elicitation/request'),
    response: codexMcpServerElicitationRequestResponseSchema,
  }).strict(),
])
export type CodexHumanServerRequestResponse = z.infer<typeof codexHumanServerRequestResponseSchema>
