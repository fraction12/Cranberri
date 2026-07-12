import { z } from 'zod'
import {
  CODEX_REASONING_EFFORT_VALUES,
  type CodexTurnSettings,
  type CodexUserInput,
} from './codex'

export const COMPOSER_DRAFT_LIMITS = {
  drafts: 256,
  identifier: 512,
  text: 1_000_000,
  mentions: 64,
  attachments: 64,
  contextInputs: 64,
  path: 4_096,
  label: 512,
  description: 10_000,
  prompt: 100_000,
  inputValue: 2_000_000,
  textElements: 512,
  draftBytes: 8 * 1_024 * 1_024,
  storeBytes: 32 * 1_024 * 1_024,
} as const

const boundedIdentifierSchema = z.string().min(1).max(COMPOSER_DRAFT_LIMITS.identifier)
const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const boundedPathSchema = z.string().min(1).max(COMPOSER_DRAFT_LIMITS.path)

export const composerDraftOwnerKeySchema = boundedIdentifierSchema

export const composerMentionSchema = z.object({
  kind: z.enum(['skill', 'plugin']),
  id: boundedIdentifierSchema,
  name: boundedIdentifierSchema,
  displayName: z.string().min(1).max(COMPOSER_DRAFT_LIMITS.label),
  path: boundedPathSchema,
  description: z.string().max(COMPOSER_DRAFT_LIMITS.description),
  prompt: z.string().max(COMPOSER_DRAFT_LIMITS.prompt).optional(),
}).strict()

const byteRangeSchema = z.object({
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(({ start, end }) => end >= start, {
  message: 'Text element byte range must not end before it starts',
})

export const composerCodexUserInputSchema: z.ZodType<CodexUserInput> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().max(COMPOSER_DRAFT_LIMITS.inputValue),
    text_elements: z.array(z.object({
      byteRange: byteRangeSchema,
      placeholder: z.string().max(COMPOSER_DRAFT_LIMITS.label).nullable().optional(),
    }).strict()).max(COMPOSER_DRAFT_LIMITS.textElements).optional(),
  }).strict(),
  z.object({
    type: z.literal('image'),
    url: z.string().min(1).max(COMPOSER_DRAFT_LIMITS.inputValue),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }).strict(),
  z.object({
    type: z.literal('localImage'),
    path: boundedPathSchema,
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }).strict(),
  z.object({
    type: z.literal('skill'),
    name: boundedIdentifierSchema,
    path: boundedPathSchema,
  }).strict(),
])

export const contextInputAttachmentSchema = z.object({
  id: boundedIdentifierSchema,
  label: z.string().min(1).max(COMPOSER_DRAFT_LIMITS.label),
  input: composerCodexUserInputSchema,
}).strict()

export const composerTurnSettingsSchema: z.ZodType<CodexTurnSettings> = z.object({
  model: boundedIdentifierSchema,
  effort: z.enum(CODEX_REASONING_EFFORT_VALUES),
  speed: z.enum(['standard', 'fast']).optional(),
  approvalMode: z.enum(['ask', 'approve', 'full', 'custom']).optional(),
}).strict()

export const pendingComposerSendSchema = z.object({
  id: boundedIdentifierSchema,
  startedAt: timestampSchema,
  threadId: boundedIdentifierSchema.optional(),
}).strict()

function serializedUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

export const composerDraftSchema = z.object({
  ownerKey: composerDraftOwnerKeySchema,
  projectId: boundedIdentifierSchema,
  windowId: boundedIdentifierSchema,
  bindingRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: timestampSchema,
  text: z.string().max(COMPOSER_DRAFT_LIMITS.text),
  mentions: z.array(composerMentionSchema).max(COMPOSER_DRAFT_LIMITS.mentions),
  attachmentPaths: z.array(boundedPathSchema).max(COMPOSER_DRAFT_LIMITS.attachments),
  contextInputAttachments: z.array(contextInputAttachmentSchema).max(COMPOSER_DRAFT_LIMITS.contextInputs),
  turnSettings: composerTurnSettingsSchema,
  planMode: z.boolean(),
  goalMode: z.boolean(),
  baseRef: z.string().min(1).max(COMPOSER_DRAFT_LIMITS.identifier),
  environmentId: boundedIdentifierSchema.nullable(),
  includeLocalChanges: z.boolean(),
  pendingSend: pendingComposerSendSchema.optional(),
}).strict().refine(
  (draft) => serializedUtf8Bytes(draft) <= COMPOSER_DRAFT_LIMITS.draftBytes,
  { message: `Composer draft cannot exceed ${COMPOSER_DRAFT_LIMITS.draftBytes} serialized bytes` },
)

export const composerDraftsStoreSchema = z.object({
  version: z.literal(1),
  drafts: z.record(composerDraftOwnerKeySchema, composerDraftSchema),
}).strict().superRefine((store, context) => {
  const entries = Object.entries(store.drafts)
  if (serializedUtf8Bytes(store) > COMPOSER_DRAFT_LIMITS.storeBytes) {
    context.addIssue({
      code: 'custom',
      message: `Composer draft store cannot exceed ${COMPOSER_DRAFT_LIMITS.storeBytes} serialized bytes`,
      path: [],
    })
  }
  if (entries.length > COMPOSER_DRAFT_LIMITS.drafts) {
    context.addIssue({
      code: 'custom',
      message: `Composer draft store cannot exceed ${COMPOSER_DRAFT_LIMITS.drafts} drafts`,
      path: ['drafts'],
    })
  }
  for (const [ownerKey, draft] of entries) {
    if (draft.ownerKey !== ownerKey) {
      context.addIssue({
        code: 'custom',
        message: 'Composer draft owner key does not match its store key',
        path: ['drafts', ownerKey, 'ownerKey'],
      })
    }
  }
})

export type ComposerMention = z.infer<typeof composerMentionSchema>
export type ContextInputAttachment = z.infer<typeof contextInputAttachmentSchema>
export type PendingComposerSend = z.infer<typeof pendingComposerSendSchema>
export type ComposerDraft = z.infer<typeof composerDraftSchema>
export type ComposerDraftsStore = z.infer<typeof composerDraftsStoreSchema>
