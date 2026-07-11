import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  environmentManifestSchema,
  type EnvironmentManifest,
  type EnvironmentProfile,
  type EnvironmentRevisionReferences,
} from '../../shared/environments'
import { hashEnvironmentToml, normalizeEnvironmentToml, parseEnvironmentToml } from './parser'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}`)
}

function atomicWrite(targetPath: string, bytes: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporaryPath, bytes, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(temporaryPath, targetPath)
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true })
    throw error
  }
}

export class EnvironmentStore {
  constructor(private readonly root = path.join(app.getPath('userData'), 'environments')) {}

  list(projectId: string): EnvironmentManifest[] {
    const projectPath = this.projectPath(projectId)
    if (!fs.existsSync(projectPath)) return []
    return fs
      .readdirSync(projectPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readManifest(projectId, entry.name))
      .sort((left, right) => left.name.localeCompare(right.name) || left.environmentId.localeCompare(right.environmentId))
  }

  readManifest(projectId: string, environmentId: string): EnvironmentManifest {
    const manifestPath = this.manifestPath(projectId, environmentId)
    try {
      return environmentManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
    } catch (error) {
      throw new Error(`Cannot read environment manifest for ${environmentId}`, { cause: error })
    }
  }

  save(projectId: string, environmentId: string, source: string, now = Date.now()): EnvironmentManifest {
    const profile = parseEnvironmentToml(source)
    const normalized = normalizeEnvironmentToml(profile)
    const revision = hashEnvironmentToml(normalized)
    const manifestPath = this.manifestPath(projectId, environmentId)
    const existing = fs.existsSync(manifestPath) ? this.readManifest(projectId, environmentId) : null
    if (existing) this.assertCurrentHead(projectId, environmentId, existing)
    const revisionPath = this.revisionPath(projectId, environmentId, revision)

    fs.mkdirSync(path.dirname(revisionPath), { recursive: true })
    if (fs.existsSync(revisionPath)) {
      if (fs.readFileSync(revisionPath, 'utf8') !== normalized) throw new Error(`Environment revision collision: ${revision}`)
    } else {
      atomicWrite(revisionPath, normalized)
    }

    const revisions = existing?.revisions.some((item) => item.revision === revision)
      ? existing.revisions
      : [...(existing?.revisions ?? []), { revision, file: `revisions/${revision}.toml`, createdAt: now }]
    const manifest = environmentManifestSchema.parse({
      version: 1,
      projectId,
      environmentId,
      name: profile.name,
      currentRevision: revision,
      trustedRevision: null,
      revisions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })

    atomicWrite(this.headPath(projectId, environmentId), normalized)
    atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return manifest
  }

  trust(projectId: string, environmentId: string, revision: string, now = Date.now()): EnvironmentManifest {
    const manifest = this.readManifest(projectId, environmentId)
    this.assertCurrentHead(projectId, environmentId, manifest)
    if (manifest.currentRevision !== revision) throw new Error('Only the current environment revision can be trusted')
    this.readRevision(projectId, environmentId, revision)
    const trusted = environmentManifestSchema.parse({ ...manifest, trustedRevision: revision, updatedAt: now })
    atomicWrite(this.manifestPath(projectId, environmentId), `${JSON.stringify(trusted, null, 2)}\n`)
    return trusted
  }

  readRevision(projectId: string, environmentId: string, revision: string): EnvironmentProfile {
    const manifest = this.readManifest(projectId, environmentId)
    const record = manifest.revisions.find((item) => item.revision === revision)
    if (!record) throw new Error(`Unknown environment revision: ${revision}`)
    const source = fs.readFileSync(this.revisionPath(projectId, environmentId, record.revision), 'utf8')
    if (hashEnvironmentToml(source) !== revision) throw new Error(`Environment revision is corrupt: ${revision}`)
    return parseEnvironmentToml(source)
  }

  delete(projectId: string, environmentId: string, references: EnvironmentRevisionReferences): void {
    const manifest = this.readManifest(projectId, environmentId)
    const referenced = new Set(
      references.references
        .filter((item) => item.projectId === projectId && item.environmentId === environmentId)
        .map((item) => item.revision),
    )
    const blocked = manifest.revisions.filter((item) => referenced.has(item.revision)).map((item) => item.revision)
    if (blocked.length > 0) throw new Error(`Cannot delete environment with referenced revisions: ${blocked.join(', ')}`)
    fs.rmSync(this.environmentPath(projectId, environmentId), { recursive: true })
  }

  private projectPath(projectId: string): string {
    assertSafeId(projectId, 'project id')
    return path.join(this.root, projectId)
  }

  private environmentPath(projectId: string, environmentId: string): string {
    assertSafeId(environmentId, 'environment id')
    return path.join(this.projectPath(projectId), environmentId)
  }

  private headPath(projectId: string, environmentId: string): string {
    return path.join(this.environmentPath(projectId, environmentId), 'environment.toml')
  }

  private manifestPath(projectId: string, environmentId: string): string {
    return path.join(this.environmentPath(projectId, environmentId), 'manifest.json')
  }

  private revisionPath(projectId: string, environmentId: string, revision: string): string {
    assertSafeId(revision, 'revision')
    return path.join(this.environmentPath(projectId, environmentId), 'revisions', `${revision}.toml`)
  }

  private assertCurrentHead(projectId: string, environmentId: string, manifest: EnvironmentManifest): void {
    try {
      const head = fs.readFileSync(this.headPath(projectId, environmentId), 'utf8')
      if (hashEnvironmentToml(head) !== manifest.currentRevision) throw new Error('Current environment head does not match manifest')
      parseEnvironmentToml(head)
    } catch (error) {
      throw new Error(`Cannot read current environment head for ${environmentId}`, { cause: error })
    }
  }
}
