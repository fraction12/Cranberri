import { z } from 'zod'

export const browserBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
})

export const browserAttachParamsSchema = z.object({
  windowId: z.string().min(1),
  profileId: z.string().min(1),
  initialUrl: z.string().optional(),
  bounds: browserBoundsSchema,
})

export const taskBrowserAttachParamsSchema = browserAttachParamsSchema.extend({
  taskId: z.string().min(1),
})

export const browserPageStateSchema = z.object({
  windowId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.string().nullable(),
})

export const browserSnapshotSchema = z.object({
  windowId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
  text: z.string(),
})

export const browserScreenshotSchema = z.object({
  windowId: z.string().min(1),
  dataUrl: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  path: z.string().optional(),
})

export const browserElementInspectionSchema = z.object({
  windowId: z.string().min(1),
  url: z.string(),
  title: z.string(),
  selector: z.string(),
  tagName: z.string(),
  text: z.string(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  styles: z.object({
    display: z.string(),
    fontFamily: z.string(),
    fontSize: z.string(),
    fontWeight: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    margin: z.string(),
    padding: z.string(),
    borderRadius: z.string(),
  }),
  attributes: z.record(z.string(), z.string()),
})

export const browserInspectElementParamsSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
}).optional()

export type BrowserBounds = z.infer<typeof browserBoundsSchema>
export type BrowserAttachParams = z.infer<typeof browserAttachParamsSchema>
export type TaskBrowserAttachParams = z.infer<typeof taskBrowserAttachParamsSchema>
export type BrowserPageState = z.infer<typeof browserPageStateSchema>
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>
export type BrowserScreenshot = z.infer<typeof browserScreenshotSchema>
export type BrowserElementInspection = z.infer<typeof browserElementInspectionSchema>
export type BrowserInspectElementParams = z.infer<typeof browserInspectElementParamsSchema>

export type BrowserEvent =
  | { type: 'state'; state: BrowserPageState }
  | { type: 'inspection'; inspection: BrowserElementInspection }
