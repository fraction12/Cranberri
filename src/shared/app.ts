import { z } from 'zod'

export const exportTextFileFilterSchema = z.object({
  name: z.string().min(1),
  extensions: z.array(z.string().min(1)).min(1),
})

export const exportTextFileParamsSchema = z.object({
  defaultPath: z.string().min(1).optional(),
  content: z.string(),
  filters: z.array(exportTextFileFilterSchema).optional(),
})

export const exportTextFileResultSchema = z.object({
  canceled: z.boolean(),
  path: z.string().optional(),
})

export type ExportTextFileParams = z.infer<typeof exportTextFileParamsSchema>
export type ExportTextFileResult = z.infer<typeof exportTextFileResultSchema>
