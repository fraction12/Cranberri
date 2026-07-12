import { z } from 'zod'

export const checkoutSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(['local', 'managed', 'external']),
  canonicalPath: z.string().min(1),
  gitCommonDir: z.string().min(1),
  ownership: z.enum(['user', 'cranberri']),
  available: z.boolean().default(true),
})

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  gitCommonDir: z.string().min(1),
  localCheckoutId: z.string().min(1),
  pinnedLocalBranch: z.string().nullable(),
  defaultEnvironmentId: z.string().nullable(),
  controlTaskId: z.string().min(1),
  localLeaseTaskId: z.string().nullable(),
})

export const projectRegistrySchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  checkouts: z.array(checkoutSchema),
  activeProjectId: z.string().nullable(),
})

export const setPinnedLocalBranchRequestSchema = z.object({
  projectId: z.string().min(1),
  branch: z.string().trim().min(1).max(255),
}).strict()

export type Checkout = z.infer<typeof checkoutSchema>
export type Project = z.infer<typeof projectSchema>
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>
export type SetPinnedLocalBranchRequest = z.infer<typeof setPinnedLocalBranchRequestSchema>

export interface ProjectWithLocalCheckout extends Project {
  path: string
}

export interface ProjectRegistryView extends ProjectRegistry {
  repos: ProjectWithLocalCheckout[]
  activeRepoId: string | null
}
