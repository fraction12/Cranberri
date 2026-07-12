import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  composerDraftOwnerKeySchema,
  composerDraftMigrationSchema,
  composerDraftSchema,
  composerDraftsStoreSchema,
  type ComposerDraft,
  type ComposerDraftsStore,
} from '../shared/composer-drafts'

export interface ComposerDraftsReadResult {
  store: ComposerDraftsStore
  source: 'primary' | 'backup' | 'default'
}

function emptyStore(): ComposerDraftsStore {
  return { version: 1, drafts: {} }
}

export function composerDraftsBackupPath(target: string): string {
  return `${target}.last-good`
}

function readCandidate(filePath: string): ComposerDraftsStore {
  return composerDraftsStoreSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

export function readComposerDraftsFile(target: string): ComposerDraftsReadResult {
  const backup = composerDraftsBackupPath(target)
  if (!fs.existsSync(target) && !fs.existsSync(backup)) {
    return { store: emptyStore(), source: 'default' }
  }

  let primaryError: unknown
  if (fs.existsSync(target)) {
    try {
      return { store: readCandidate(target), source: 'primary' }
    } catch (error) {
      primaryError = error
    }
  }

  if (fs.existsSync(backup)) {
    try {
      return { store: readCandidate(backup), source: 'backup' }
    } catch (backupError) {
      throw new Error('Cannot read composer drafts primary or backup', {
        cause: backupError,
      })
    }
  }

  throw new Error('Cannot read composer drafts primary or backup', { cause: primaryError })
}

function isValidStore(bytes: string): boolean {
  try {
    composerDraftsStoreSchema.parse(JSON.parse(bytes))
    return true
  } catch {
    return false
  }
}

export function writeComposerDraftsFile(
  target: string,
  store: ComposerDraftsStore,
): ComposerDraftsStore {
  const parsed = composerDraftsStoreSchema.parse(store)
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
  const temporary = `${target}.${nonce}.tmp`
  const backup = composerDraftsBackupPath(target)
  const backupTemporary = `${backup}.${nonce}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, JSON.stringify(parsed))

  if (fs.existsSync(target)) {
    const previous = fs.readFileSync(target, 'utf8')
    if (isValidStore(previous)) {
      fs.writeFileSync(backupTemporary, previous)
      fs.renameSync(backupTemporary, backup)
    }
  }

  fs.renameSync(temporary, target)
  return parsed
}

function targetPath(): string {
  return path.join(app.getPath('userData'), 'composer-drafts.json')
}

export function readComposerDraft(
  ownerKey: string,
  target = targetPath(),
): ComposerDraft | null {
  const parsedOwnerKey = composerDraftOwnerKeySchema.parse(ownerKey)
  return readComposerDraftsFile(target).store.drafts[parsedOwnerKey] ?? null
}

export function writeComposerDraft(
  draft: ComposerDraft,
  target = targetPath(),
): ComposerDraft {
  const parsedDraft = composerDraftSchema.parse(draft)
  const current = readComposerDraftsFile(target).store
  writeComposerDraftsFile(target, {
    ...current,
    drafts: { ...current.drafts, [parsedDraft.ownerKey]: parsedDraft },
  })
  return parsedDraft
}

export function deleteComposerDraft(
  ownerKey: string,
  target = targetPath(),
): { ok: true } {
  const parsedOwnerKey = composerDraftOwnerKeySchema.parse(ownerKey)
  const current = readComposerDraftsFile(target).store
  const drafts = { ...current.drafts }
  delete drafts[parsedOwnerKey]
  writeComposerDraftsFile(target, { ...current, drafts })
  return { ok: true }
}

export function migrateComposerDraft(
  legacyOwnerKey: string,
  ownerKey: string,
  target = targetPath(),
): ComposerDraft | null {
  const request = composerDraftMigrationSchema.parse({ legacyOwnerKey, ownerKey })
  const current = readComposerDraftsFile(target).store
  const existing = current.drafts[request.ownerKey]
  const legacy = current.drafts[request.legacyOwnerKey]
  if (existing) {
    if (!legacy) return existing
    const drafts = { ...current.drafts }
    delete drafts[request.legacyOwnerKey]
    writeComposerDraftsFile(target, { ...current, drafts })
    return existing
  }
  if (!legacy) return null
  const migrated = composerDraftSchema.parse({ ...legacy, ownerKey: request.ownerKey })
  const drafts = { ...current.drafts, [request.ownerKey]: migrated }
  delete drafts[request.legacyOwnerKey]
  writeComposerDraftsFile(target, { ...current, drafts })
  return migrated
}

export function initComposerDraftsIpc(): void {
  ipcMain.handle('composer-drafts:read', (_, ownerKey: unknown) => (
    readComposerDraft(composerDraftOwnerKeySchema.parse(ownerKey))
  ))
  ipcMain.handle('composer-drafts:write', (_, draft: unknown) => (
    writeComposerDraft(composerDraftSchema.parse(draft))
  ))
  ipcMain.handle('composer-drafts:delete', (_, ownerKey: unknown) => (
    deleteComposerDraft(composerDraftOwnerKeySchema.parse(ownerKey))
  ))
  ipcMain.handle('composer-drafts:migrate', (_, raw: unknown) => {
    const request = composerDraftMigrationSchema.parse(raw)
    return migrateComposerDraft(request.legacyOwnerKey, request.ownerKey)
  })
}
