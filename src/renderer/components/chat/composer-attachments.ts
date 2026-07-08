import type { CodexUserInput } from '@/shared/codex'

const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const IMAGE_MIME_PREFIX = 'image/'

export type ClipboardImageFile = Pick<File, 'name' | 'type'> & { path?: string }
export type TransferFile = Pick<File, 'name' | 'type'> & { path?: string }

export interface VisualAttachmentPreview {
  src: string
  label: string
}

function extensionFromReference(value: string): string {
  const withoutHash = value.split('#')[0] ?? value
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash
  const lastSlash = withoutQuery.lastIndexOf('/')
  const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function unquoteReference(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  return (first === last && (first === '"' || first === "'")) ? trimmed.slice(1, -1).trim() : trimmed
}

function unescapeShellPath(value: string): string {
  return value.replace(/\\([\\ "'()&[\]{}$!#;*?<>|])/g, '$1')
}

function normalizedPastedReference(value: string): string {
  return unescapeShellPath(unquoteReference(value))
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export function localPathToMediaUrl(filePath: string): string {
  return `cranberri-media://local/?path=${encodeURIComponent(filePath)}`
}

export function isLocalImagePath(filePath: string): boolean {
  return IMAGE_ATTACHMENT_EXTENSIONS.has(extensionFromReference(filePath))
}

export function isClipboardImageFile(file: ClipboardImageFile): boolean {
  const type = file.type.toLowerCase()
  return type.startsWith(IMAGE_MIME_PREFIX) || isLocalImagePath(file.path ?? file.name)
}

function localAttachmentPathFromReference(value: string): string | null {
  const reference = normalizedPastedReference(value)
  if (!reference) return null
  if (imageInputFromReference(reference)) return null
  if (reference.toLowerCase().startsWith('file://')) return localPathFromFileUrl(reference)
  if (!reference.startsWith('/')) return null
  if (!reference.slice(1).includes('/')) return null
  return reference
}

export function localAttachmentPathsFromTransferFiles(files: ArrayLike<TransferFile>): string[] {
  const seen = new Set<string>()
  const paths: string[] = []

  for (const file of Array.from(files)) {
    const filePath = file.path?.trim()
    if (!filePath || isClipboardImageFile(file) || seen.has(filePath)) continue
    seen.add(filePath)
    paths.push(filePath)
  }

  return paths
}

function localPathFromFileUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    const pathname = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname !== 'localhost') return `//${url.hostname}${pathname}`
    return pathname
  } catch {
    return null
  }
}

export function imageInputFromReference(value: string): CodexUserInput | null {
  const reference = normalizedPastedReference(value)
  if (!reference) return null
  const lowerReference = reference.toLowerCase()
  if (lowerReference.startsWith('data:image/')) return { type: 'image', url: reference, detail: 'high' }
  if ((lowerReference.startsWith('http://') || lowerReference.startsWith('https://')) && IMAGE_ATTACHMENT_EXTENSIONS.has(extensionFromReference(reference))) {
    return { type: 'image', url: reference, detail: 'high' }
  }
  if (lowerReference.startsWith('file://')) {
    const localPath = localPathFromFileUrl(reference)
    return localPath && isLocalImagePath(localPath) ? { type: 'localImage', path: localPath, detail: 'high' } : null
  }
  if (reference.startsWith('/') && isLocalImagePath(reference)) return { type: 'localImage', path: reference, detail: 'high' }
  return null
}

export async function imageInputFromClipboardFile(
  file: ClipboardImageFile,
  readAsDataUrl: (file: ClipboardImageFile) => Promise<string>,
): Promise<CodexUserInput | null> {
  if (!isClipboardImageFile(file)) return null
  if (file.path && isLocalImagePath(file.path)) return { type: 'localImage', path: file.path, detail: 'high' }

  const url = await readAsDataUrl(file)
  return url.toLowerCase().startsWith('data:image/') ? { type: 'image', url, detail: 'high' } : null
}

export function pastedImageInputsFromText(text: string): { inputParts: CodexUserInput[]; remainingText: string } {
  const inputParts: CodexUserInput[] = []
  const remainingLines: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const inputPart = imageInputFromReference(line)
    if (inputPart) {
      inputParts.push(inputPart)
    } else {
      remainingLines.push(line)
    }
  }

  return {
    inputParts,
    remainingText: remainingLines.join('\n').trim(),
  }
}

export function pastedAttachmentInputsFromText(text: string): {
  inputParts: CodexUserInput[]
  attachmentPaths: string[]
  remainingText: string
} {
  const inputParts: CodexUserInput[] = []
  const attachmentPaths: string[] = []
  const seenAttachmentPaths = new Set<string>()
  const remainingLines: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const inputPart = imageInputFromReference(line)
    if (inputPart) {
      inputParts.push(inputPart)
      continue
    }

    const attachmentPath = localAttachmentPathFromReference(line)
    if (attachmentPath) {
      if (!seenAttachmentPaths.has(attachmentPath)) {
        seenAttachmentPaths.add(attachmentPath)
        attachmentPaths.push(attachmentPath)
      }
      continue
    }

    remainingLines.push(line)
  }

  return {
    inputParts,
    attachmentPaths,
    remainingText: remainingLines.join('\n').trim(),
  }
}

export function contextInputLabel(input: CodexUserInput): string {
  if (input.type === 'localImage') return fileNameFromPath(input.path)
  if (input.type === 'image') {
    if (input.url.toLowerCase().startsWith('data:image/')) return 'Inline image'
    return input.url.split(/[?#]/)[0]?.split('/').pop() || 'Image'
  }
  if (input.type === 'skill') return input.name
  return 'Context'
}

export function visualInputPreview(input: CodexUserInput): VisualAttachmentPreview | null {
  if (input.type === 'localImage' && isLocalImagePath(input.path)) {
    return { src: localPathToMediaUrl(input.path), label: contextInputLabel(input) }
  }
  if (input.type === 'image') {
    const lowerUrl = input.url.toLowerCase()
    if (lowerUrl.startsWith('data:image/') || lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
      return { src: input.url, label: contextInputLabel(input) }
    }
  }
  return null
}

export function attachmentPreviewFromPath(filePath: string): VisualAttachmentPreview | null {
  if (!isLocalImagePath(filePath)) return null
  return { src: localPathToMediaUrl(filePath), label: fileNameFromPath(filePath) }
}
