import { createHash } from 'node:crypto'
import { parse, stringify, type TomlTable } from 'smol-toml'
import { z } from 'zod'
import {
  environmentActionSchema,
  environmentPlatformSchema,
  environmentProfileSchema,
  type EnvironmentAction,
  type EnvironmentPlatform,
  type EnvironmentProfile,
} from '../../shared/environments'

const rawPlatformSchema = z.object({
  macos: z.object({ setup_script: z.string().optional() }).optional(),
  windows: z.object({ setup_script: z.string().optional() }).optional(),
  linux: z.object({ setup_script: z.string().optional() }).optional(),
}).strict()

const rawActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  script: z.string(),
  platform: z
    .object({
      macos: z.string().optional(),
      windows: z.string().optional(),
      linux: z.string().optional(),
    })
    .strict()
    .optional(),
}).strict()

const rawEnvironmentSchema = z.object({
  version: z.number(),
  name: z.string(),
  setup: z.object({ script: z.string() }),
  cranberri: z
    .object({
      inherit: z.array(z.string()).optional(),
      platform: rawPlatformSchema.optional(),
      actions: z.array(rawActionSchema).optional(),
    })
    .strict()
    .optional(),
})

export function parseEnvironmentToml(source: string): EnvironmentProfile {
  const raw = rawEnvironmentSchema.parse(parse(source))
  const extension = raw.cranberri
  return environmentProfileSchema.parse({
    version: raw.version,
    name: raw.name,
    setup: {
      script: raw.setup.script,
      platform: {
        macos: extension?.platform?.macos?.setup_script,
        windows: extension?.platform?.windows?.setup_script,
        linux: extension?.platform?.linux?.setup_script,
      },
    },
    inherit: extension?.inherit ?? [],
    actions: (extension?.actions ?? []).map((action) => environmentActionSchema.parse(action)),
  })
}

function compactPlatformScripts(platform: EnvironmentProfile['setup']['platform']): Record<string, string> {
  return Object.fromEntries(
    environmentPlatformSchema.options.flatMap((name) => (platform[name] ? [[name, platform[name]]] : [])),
  )
}

export function normalizeEnvironmentToml(input: EnvironmentProfile): string {
  const profile = environmentProfileSchema.parse(input)
  const setupPlatform = Object.fromEntries(
    Object.entries(compactPlatformScripts(profile.setup.platform)).map(([name, script]) => [name, { setup_script: script }]),
  )
  const cranberri: TomlTable = {}

  if (profile.inherit.length > 0) cranberri.inherit = profile.inherit
  if (Object.keys(setupPlatform).length > 0) cranberri.platform = setupPlatform
  if (profile.actions.length > 0) {
    cranberri.actions = profile.actions.map((action) => {
      const normalized: TomlTable = { id: action.id, name: action.name, script: action.script }
      const platform = compactPlatformScripts(action.platform)
      if (Object.keys(platform).length > 0) normalized.platform = platform
      return normalized
    })
  }

  const document: TomlTable = {
    version: profile.version,
    name: profile.name,
    setup: { script: profile.setup.script },
  }
  if (Object.keys(cranberri).length > 0) document.cranberri = cranberri
  return `${stringify(document).trimEnd()}\n`
}

export function hashEnvironmentToml(normalizedToml: string): string {
  return createHash('sha256').update(normalizedToml, 'utf8').digest('hex')
}

export function resolveSetupScript(profile: EnvironmentProfile, platform: EnvironmentPlatform): string {
  return profile.setup.platform[platform] ?? profile.setup.script
}

export function resolveActionScript(action: EnvironmentAction, platform: EnvironmentPlatform): string {
  return action.platform[platform] ?? action.script
}
