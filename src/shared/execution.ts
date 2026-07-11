import { z } from 'zod'

export const executionRequestSchema = z.object({ taskId: z.string().min(1) }).strict()
export const executionFileRequestSchema = executionRequestSchema.extend({
  filePath: z.string().min(1),
}).strict()

export type ExecutionRequest = z.infer<typeof executionRequestSchema>
export type ExecutionFileRequest = z.infer<typeof executionFileRequestSchema>
