import { z } from 'zod'

export const authorityChangedEventSchema = z.object({
  authority: z.enum(['tasks', 'workspace', 'codex']),
  revision: z.number().int().nonnegative(),
  affectedIds: z.array(z.string().min(1)).optional(),
})

export type AuthorityChangedEvent = z.infer<typeof authorityChangedEventSchema>
