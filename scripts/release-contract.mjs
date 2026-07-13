export function assertReleaseIdentity({ currentCommit, packageVersion, tag, tagCommit }) {
  if (tag !== `v${packageVersion}`) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`)
  }
  if (tagCommit && tagCommit !== currentCommit) {
    throw new Error(`Release tag ${tag} already identifies a different commit (${tagCommit})`)
  }
}
