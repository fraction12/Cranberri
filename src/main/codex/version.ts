export const MINIMUM_GPT_56_CODEX_VERSION = '0.144.0'

interface ParsedVersion {
  version: string
  core: [number, number, number]
  prerelease: string | null
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!match) return null
  return {
    version: match[0],
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  }
}

export function parseCodexCliVersion(output: string): string | null {
  return parseVersion(output)?.version ?? null
}

export function codexCliNeedsUpdate(
  output: string,
  minimumVersion = MINIMUM_GPT_56_CODEX_VERSION,
): boolean {
  const current = parseVersion(output)
  const minimum = parseVersion(minimumVersion)
  if (!current || !minimum) return true

  for (let index = 0; index < current.core.length; index += 1) {
    if (current.core[index] < minimum.core[index]) return true
    if (current.core[index] > minimum.core[index]) return false
  }

  if (current.prerelease && !minimum.prerelease) return true
  if (!current.prerelease || !minimum.prerelease) return false
  return current.prerelease.localeCompare(minimum.prerelease, undefined, { numeric: true }) < 0
}
