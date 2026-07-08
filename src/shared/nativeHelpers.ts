import { z } from 'zod'

export const nativeHelperAvailabilitySchema = z.enum(['available', 'disabled', 'unavailable', 'error'])
export type NativeHelperAvailability = z.infer<typeof nativeHelperAvailabilitySchema>

export const nativeHelperSettingsTargetSchema = z.enum(['macos-accessibility', 'macos-apple-events'])
export type NativeHelperSettingsTarget = z.infer<typeof nativeHelperSettingsTargetSchema>

export const nativeHelperCapabilitySchema = z.enum([
  'macos-accessibility',
  'macos-apple-events',
  'apple-script',
  'jxa',
])
export type NativeHelperCapability = z.infer<typeof nativeHelperCapabilitySchema>

export const nativeHelperStatusSchema = z.object({
  id: nativeHelperCapabilitySchema,
  label: z.string(),
  availability: nativeHelperAvailabilitySchema,
  detail: z.string(),
  settingsTarget: nativeHelperSettingsTargetSchema.optional(),
})

export type NativeHelperStatus = z.infer<typeof nativeHelperStatusSchema>
