import z from 'zod'
import buildInfoJson from './buildInfo.generated.json'

const buildInfoSchema = z.object({
  commit: z.string(),
  branch: z.string(),
  commitTime: z.string(),
  buildTime: z.string(),
  version: z.string(),
  packaged: z.boolean(),
  channel: z.enum(['development', 'uat', 'release']),
  schemas: z.object({
    appState: z.number().int().positive(),
    taskStore: z.number().int().positive(),
    composerDrafts: z.number().int().positive(),
  }),
})

export const buildInfo = buildInfoSchema.catch({
  commit: 'unknown',
  branch: 'unknown',
  commitTime: new Date(0).toISOString(),
  buildTime: new Date(0).toISOString(),
  version: '0.0.0',
  packaged: false,
  channel: 'development',
  schemas: { appState: 3, taskStore: 2, composerDrafts: 1 },
}).parse(buildInfoJson)

export type BuildInfo = z.infer<typeof buildInfoSchema>
export type BuildChannel = BuildInfo['channel']
