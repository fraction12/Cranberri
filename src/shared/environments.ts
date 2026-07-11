import { z } from 'zod'

export const environmentPlatformSchema = z.enum(['macos', 'windows', 'linux'])
export type EnvironmentPlatform = z.infer<typeof environmentPlatformSchema>

const scriptSchema = z.string().trim().min(1)
const platformScriptsSchema = z.object({
  macos: scriptSchema.optional(),
  windows: scriptSchema.optional(),
  linux: scriptSchema.optional(),
}).strict()

export const environmentActionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(80),
  script: scriptSchema,
  platform: platformScriptsSchema.default({}),
}).strict()
export type EnvironmentAction = z.infer<typeof environmentActionSchema>

export const environmentProfileSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    setup: z.object({
      script: scriptSchema,
      platform: platformScriptsSchema.default({}),
    }),
    inherit: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
      .default([])
      .transform((names) => [...new Set(names)].sort()),
    actions: z.array(environmentActionSchema).default([]),
  })
  .superRefine((profile, context) => {
    const ids = new Set<string>()
    for (const [index, action] of profile.actions.entries()) {
      if (ids.has(action.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate action id: ${action.id}`, path: ['actions', index, 'id'] })
      }
      ids.add(action.id)
    }
  })

export type EnvironmentProfile = z.infer<typeof environmentProfileSchema>

export const environmentRevisionSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  file: z.string().regex(/^revisions\/[a-f0-9]{64}\.toml$/),
  createdAt: z.number().int().nonnegative(),
})

export const environmentManifestSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().min(1),
    environmentId: z.string().min(1),
    name: z.string().min(1),
    currentRevision: environmentRevisionSchema.shape.revision,
    trustedRevision: environmentRevisionSchema.shape.revision.nullable(),
    revisions: z.array(environmentRevisionSchema),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .superRefine((manifest, context) => {
    for (const [index, item] of manifest.revisions.entries()) {
      if (item.file !== `revisions/${item.revision}.toml`) {
        context.addIssue({ code: 'custom', message: 'Revision path does not match its hash', path: ['revisions', index, 'file'] })
      }
    }
    if (!manifest.revisions.some((item) => item.revision === manifest.currentRevision)) {
      context.addIssue({ code: 'custom', message: 'Current revision is missing', path: ['currentRevision'] })
    }
    if (manifest.trustedRevision && !manifest.revisions.some((item) => item.revision === manifest.trustedRevision)) {
      context.addIssue({ code: 'custom', message: 'Trusted revision is missing', path: ['trustedRevision'] })
    }
  })

export type EnvironmentManifest = z.infer<typeof environmentManifestSchema>

export interface EnvironmentRevisionReference {
  projectId: string
  environmentId: string
  revision: string
}

export interface EnvironmentRevisionReferences {
  references: readonly EnvironmentRevisionReference[]
}

export const environmentProjectRequestSchema = z.object({ projectId: z.string().min(1) }).strict()
export const environmentIdentityRequestSchema = environmentProjectRequestSchema.extend({
  environmentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
})
export const environmentRevisionRequestSchema = environmentIdentityRequestSchema.extend({
  revision: environmentRevisionSchema.shape.revision,
})
export const environmentSaveRequestSchema = environmentIdentityRequestSchema.extend({
  profile: environmentProfileSchema,
})
export const environmentDefaultRequestSchema = environmentProjectRequestSchema.extend({
  environmentId: z.string().min(1).nullable(),
})

export interface EnvironmentRecord {
  manifest: EnvironmentManifest
  profile: EnvironmentProfile
}

export type EnvironmentSaveRequest = z.infer<typeof environmentSaveRequestSchema>
