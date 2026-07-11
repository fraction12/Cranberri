import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvironmentStore } from './store'

const TOML = 'version = 1\nname = "Node"\n[setup]\nscript = "npm install"\n'
const EDITED_TOML = 'version = 1\nname = "Node"\n[setup]\nscript = "npm ci"\n'

describe('EnvironmentStore', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-environments-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('associates profiles with projects and revokes trust on every edit', () => {
    const store = new EnvironmentStore(root)
    const created = store.save('project-a', 'node', TOML, 10)
    expect(store.list('project-a')).toHaveLength(1)
    expect(store.list('project-b')).toEqual([])

    store.trust('project-a', 'node', created.currentRevision, 11)
    expect(store.readManifest('project-a', 'node').trustedRevision).toBe(created.currentRevision)

    expect(store.save('project-a', 'node', TOML, 12).trustedRevision).toBeNull()

    const edited = store.save('project-a', 'node', EDITED_TOML, 13)
    expect(edited.currentRevision).not.toBe(created.currentRevision)
    expect(edited.trustedRevision).toBeNull()
  })

  it('retains immutable revisions after edits', () => {
    const store = new EnvironmentStore(root)
    const first = store.save('project', 'node', TOML, 10)
    const second = store.save('project', 'node', EDITED_TOML, 20)

    expect(store.readRevision('project', 'node', first.currentRevision).setup.script).toBe('npm install')
    expect(store.readRevision('project', 'node', second.currentRevision).setup.script).toBe('npm ci')
    expect(second.revisions).toHaveLength(2)
  })

  it('refuses deletion while an immutable revision is referenced', () => {
    const store = new EnvironmentStore(root)
    const manifest = store.save('project', 'node', TOML, 10)

    expect(() =>
      store.delete('project', 'node', {
        references: [{ projectId: 'project', environmentId: 'node', revision: manifest.currentRevision }],
      }),
    ).toThrow(/referenced/i)
    expect(store.readRevision('project', 'node', manifest.currentRevision).name).toBe('Node')

    store.delete('project', 'node', { references: [] })
    expect(store.list('project')).toEqual([])
  })

  it('fails closed and preserves corrupt manifest bytes', () => {
    const store = new EnvironmentStore(root)
    store.save('project', 'node', TOML, 10)
    const manifestPath = path.join(root, 'project', 'node', 'manifest.json')
    const corrupt = Buffer.from('{ not valid json \u0000')
    fs.writeFileSync(manifestPath, corrupt)

    expect(() => store.readManifest('project', 'node')).toThrow(/manifest/i)
    expect(fs.readFileSync(manifestPath)).toEqual(corrupt)
    expect(() => store.save('project', 'node', EDITED_TOML, 20)).toThrow(/manifest/i)
    expect(fs.readFileSync(manifestPath)).toEqual(corrupt)
  })

  it('fails closed and preserves a corrupt mutable head', () => {
    const store = new EnvironmentStore(root)
    store.save('project', 'node', TOML, 10)
    const headPath = path.join(root, 'project', 'node', 'environment.toml')
    const corrupt = Buffer.from('not = [valid')
    fs.writeFileSync(headPath, corrupt)

    expect(() => store.save('project', 'node', EDITED_TOML, 20)).toThrow(/current environment head/i)
    expect(fs.readFileSync(headPath)).toEqual(corrupt)
  })
})
