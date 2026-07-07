import z from 'zod'
import buildInfoJson from './buildInfo.json'

const buildInfoSchema = z.object({
  commit: z.string(),
  branch: z.string(),
  commitTime: z.string(),
  buildTime: z.string(),
  version: z.string(),
  packaged: z.boolean(),
})

export const buildInfo = buildInfoSchema.catch({
  commit: 'unknown',
  branch: 'unknown',
  commitTime: new Date(0).toISOString(),
  buildTime: new Date(0).toISOString(),
  version: '0.0.0',
  packaged: false,
}).parse(buildInfoJson)

export type BuildInfo = z.infer<typeof buildInfoSchema>
