import { useState } from 'react'
import { Check, ExternalLink, ImagePlus } from 'lucide-react'
import { createSendChatContextEvent } from './chat-context-events'
import type { CodexUserInput } from '@/shared/codex'

export type MarkdownMediaKind = 'image' | 'video'

export interface MarkdownMediaSource {
  kind: MarkdownMediaKind
  src: string
  openUrl?: string
  localPath?: string
  originalUrl: string
}

const IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.ogg', '.ogv', '.webm'])

function extensionFromUrl(value: string): string {
  const withoutHash = value.split('#')[0] ?? value
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash
  const lastSlash = withoutQuery.lastIndexOf('/')
  const filename = lastSlash >= 0 ? withoutQuery.slice(lastSlash + 1) : withoutQuery
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function mediaKindFromUrl(value: string): MarkdownMediaKind | null {
  if (value.startsWith('data:image/')) return 'image'
  if (value.startsWith('data:video/')) return 'video'
  const extension = extensionFromUrl(value)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return null
}

function localPathToMediaUrl(value: string): string {
  return `cranberri-media://local/?path=${encodeURIComponent(value)}`
}

function localPathToFileUrl(value: string): string {
  return `file://${value.split('/').map((segment, index) => index === 0 ? '' : encodeURIComponent(segment)).join('/')}`
}

function fileUrlToLocalPath(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : null
  } catch {
    return null
  }
}

export function markdownMediaSourceFromUrl(url?: string): MarkdownMediaSource | null {
  const originalUrl = url?.trim()
  if (!originalUrl) return null

  const lowerUrl = originalUrl.toLowerCase()
  const isDataMedia = lowerUrl.startsWith('data:image/') || lowerUrl.startsWith('data:video/')
  const isRemote = lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')
  const isFileUrl = lowerUrl.startsWith('file://')
  const isAbsoluteLocalPath = originalUrl.startsWith('/')
  if (!isDataMedia && !isRemote && !isFileUrl && !isAbsoluteLocalPath) return null

  const kind = mediaKindFromUrl(lowerUrl)
  if (!kind) return null

  const fileUrlPath = isFileUrl ? fileUrlToLocalPath(originalUrl) : null
  const src = isAbsoluteLocalPath
    ? localPathToMediaUrl(originalUrl)
    : fileUrlPath
      ? localPathToMediaUrl(fileUrlPath)
      : originalUrl
  const openUrl = isAbsoluteLocalPath ? localPathToFileUrl(originalUrl) : isDataMedia ? undefined : originalUrl
  return {
    kind,
    src,
    openUrl,
    ...(isAbsoluteLocalPath ? { localPath: originalUrl } : fileUrlPath ? { localPath: fileUrlPath } : {}),
    originalUrl,
  }
}

function openMedia(url: string): void {
  window.cranberri.openExternal(url).catch((error) => console.error('Failed to open media:', error))
}

export function markdownMediaChatContext(source: MarkdownMediaSource, label?: string): string {
  return [
    'Image from assistant markdown:',
    label ? `- Label: ${label}` : null,
    source.localPath ? `- Path: ${source.localPath}` : source.originalUrl.startsWith('data:image/') ? '- Source: inline data image' : `- Source: ${source.originalUrl}`,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

export function markdownMediaImageInput(source: MarkdownMediaSource): CodexUserInput | null {
  if (source.kind !== 'image') return null
  if (source.localPath) return { type: 'localImage', path: source.localPath, detail: 'high' }
  const lowerUrl = source.originalUrl.toLowerCase()
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://') || lowerUrl.startsWith('data:image/')) {
    return { type: 'image', url: source.originalUrl, detail: 'high' }
  }
  return null
}

export function MarkdownMedia({ source, label }: { source: MarkdownMediaSource; label?: string }) {
  const title = label || source.originalUrl
  const [sent, setSent] = useState(false)
  const imageInput = markdownMediaImageInput(source)
  const canSendToChat = Boolean(imageInput)
  const sendToChat = () => {
    if (!imageInput) return
    window.dispatchEvent(createSendChatContextEvent({
      text: markdownMediaChatContext(source, label),
      inputParts: [imageInput],
    }))
    setSent(true)
    window.setTimeout(() => setSent(false), 1800)
  }

  return (
    <figure
      className="my-4 overflow-hidden rounded-lg border border-app-border bg-app-surface"
      data-markdown-media={source.kind}
    >
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-app-border bg-app-surface-2 px-3 py-1.5 text-micro uppercase text-app-text-muted">
        <figcaption className="truncate" title={title}>{title}</figcaption>
        <span className="flex items-center gap-1">
          {canSendToChat && (
            <button
              type="button"
              onClick={sendToChat}
              className="rounded p-0.5 text-app-text-muted hover:bg-app-surface hover:text-app-text"
              aria-label="Send image to chat"
              title="Send image to chat"
            >
              {sent ? <Check className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
            </button>
          )}
          {source.openUrl && (
            <button
              type="button"
              onClick={() => openMedia(source.openUrl!)}
              className="rounded p-0.5 text-app-text-muted hover:bg-app-surface hover:text-app-text"
              aria-label="Open media"
              title="Open media"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <div className="bg-app-bg p-3">
        {source.kind === 'image' ? (
          <img
            src={source.src}
            alt={label ?? ''}
            className="max-h-[560px] max-w-full rounded border border-app-border object-contain"
            loading="lazy"
          />
        ) : (
          <video
            src={source.src}
            controls
            className="max-h-[560px] max-w-full rounded border border-app-border"
          >
            <a href={source.src}>{title}</a>
          </video>
        )}
      </div>
    </figure>
  )
}
