const BUILD_CHANNELS = new Set(['development', 'uat', 'release'])

export function resolveBuildChannel({ packaged, requested }) {
  if (requested !== undefined && !BUILD_CHANNELS.has(requested)) {
    throw new Error(`Unknown Cranberri build channel: ${requested}`)
  }
  return requested ?? (packaged ? 'uat' : 'development')
}
