import { describe, expect, it } from 'vitest'
import {
  contextInputLabel,
  attachmentPreviewFromPath,
  imageInputFromReference,
  imageInputFromClipboardFile,
  isClipboardImageFile,
  isLocalImagePath,
  localAttachmentPathsFromTransferFiles,
  localPathToMediaUrl,
  pastedAttachmentInputsFromText,
  pastedImageInputsFromText,
  visualInputPreview,
  type ClipboardImageFile,
} from './composer-attachments'

describe('composer attachments', () => {
  it('detects local image paths and ignores non-image paths', () => {
    expect(isLocalImagePath('/Users/example/Desktop/smoke.PNG')).toBe(true)
    expect(isLocalImagePath('/Users/example/Desktop/notes.txt')).toBe(false)
  })

  it('converts direct image references into Codex visual inputs', () => {
    expect(imageInputFromReference('/Users/example/Desktop/smoke.png')).toEqual({
      type: 'localImage',
      path: '/Users/example/Desktop/smoke.png',
      detail: 'high',
    })
    expect(imageInputFromReference('file:///Users/example/Desktop/smoke.png')).toEqual({
      type: 'localImage',
      path: '/Users/example/Desktop/smoke.png',
      detail: 'high',
    })
    expect(imageInputFromReference('https://example.com/smoke.webp?width=1200')).toEqual({
      type: 'image',
      url: 'https://example.com/smoke.webp?width=1200',
      detail: 'high',
    })
    expect(imageInputFromReference('data:image/png;base64,AAAA')).toEqual({
      type: 'image',
      url: 'data:image/png;base64,AAAA',
      detail: 'high',
    })
    expect(imageInputFromReference('https://example.com/readme')).toBeNull()
  })

  it('detects clipboard image files without treating every file as visual input', () => {
    expect(isClipboardImageFile({ name: 'clipboard.png', type: 'image/png' })).toBe(true)
    expect(isClipboardImageFile({ name: 'screenshot', type: 'image/png' })).toBe(true)
    expect(isClipboardImageFile({ name: 'screenshot.webp', type: '' })).toBe(true)
    expect(isClipboardImageFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false)
  })

  it('extracts dropped local file paths while keeping images on the visual-input path', () => {
    expect(localAttachmentPathsFromTransferFiles([
      { name: 'notes.txt', type: 'text/plain', path: '/Users/example/Desktop/notes.txt' },
      { name: 'fixture', type: '', path: '/Users/example/Desktop/fixture' },
      { name: 'capture.png', type: 'image/png', path: '/Users/example/Desktop/capture.png' },
      { name: 'clipboard.txt', type: 'text/plain' },
      { name: 'notes-copy.txt', type: 'text/plain', path: '/Users/example/Desktop/notes.txt' },
    ])).toEqual([
      '/Users/example/Desktop/notes.txt',
      '/Users/example/Desktop/fixture',
    ])
  })

  it('converts pasted clipboard image files into Codex visual inputs', async () => {
    const readAsDataUrl = async () => 'data:image/png;base64,AAAA'

    await expect(imageInputFromClipboardFile({
      name: 'capture.png',
      path: '/Users/example/Desktop/capture.png',
      type: 'image/png',
    }, readAsDataUrl)).resolves.toEqual({
      type: 'localImage',
      path: '/Users/example/Desktop/capture.png',
      detail: 'high',
    })

    await expect(imageInputFromClipboardFile({ name: 'clipboard.png', type: 'image/png' }, readAsDataUrl)).resolves.toEqual({
      type: 'image',
      url: 'data:image/png;base64,AAAA',
      detail: 'high',
    })

    await expect(imageInputFromClipboardFile(
      { name: 'notes.txt', type: 'text/plain' },
      async () => 'data:text/plain;base64,AAAA',
    )).resolves.toBeNull()
  })

  it('ignores clipboard image files when the data reader does not return image data', async () => {
    const clipboardFile: ClipboardImageFile = { name: 'capture.png', type: 'image/png' }

    await expect(imageInputFromClipboardFile(
      clipboardFile,
      async () => 'data:text/plain;base64,AAAA',
    )).resolves.toBeNull()
  })

  it('extracts image references from pasted text and preserves the remaining prompt', () => {
    const result = pastedImageInputsFromText([
      'Please inspect this screenshot.',
      'https://example.com/smoke.png',
      '/Users/example/Desktop/another.jpg',
    ].join('\n'))

    expect(result.remainingText).toBe('Please inspect this screenshot.')
    expect(result.inputParts).toEqual([
      { type: 'image', url: 'https://example.com/smoke.png', detail: 'high' },
      { type: 'localImage', path: '/Users/example/Desktop/another.jpg', detail: 'high' },
    ])
  })

  it('extracts standalone pasted local paths without consuming commands or inline prose', () => {
    const result = pastedAttachmentInputsFromText([
      'Please inspect these files.',
      '/Users/example/Project/src/App.tsx',
      'file:///Users/example/Project/package.json',
      '/Users/example/Project/src/App.tsx',
      '/Users/example/Desktop/screenshot.png',
      '/compact',
      'Inline path /Users/example/Project/src/main.ts should stay prose.',
    ].join('\n'))

    expect(result.remainingText).toBe([
      'Please inspect these files.',
      '/compact',
      'Inline path /Users/example/Project/src/main.ts should stay prose.',
    ].join('\n'))
    expect(result.attachmentPaths).toEqual([
      '/Users/example/Project/src/App.tsx',
      '/Users/example/Project/package.json',
    ])
    expect(result.inputParts).toEqual([
      { type: 'localImage', path: '/Users/example/Desktop/screenshot.png', detail: 'high' },
    ])
  })

  it('normalizes quoted file URLs and shell-escaped pasted local paths', () => {
    const result = pastedAttachmentInputsFromText([
      'Please inspect these local references.',
      '"/Users/example/Project/src/My File.tsx"',
      '/Users/example/Project/src/My\\ Other\\ File.ts',
      'file://localhost/Users/example/Project/encoded%20name.json',
      'file://server.local/Share/fixture.txt',
      '/Users/example/Desktop/escaped\\ screenshot.png',
    ].join('\n'))

    expect(result.remainingText).toBe('Please inspect these local references.')
    expect(result.attachmentPaths).toEqual([
      '/Users/example/Project/src/My File.tsx',
      '/Users/example/Project/src/My Other File.ts',
      '/Users/example/Project/encoded name.json',
      '//server.local/Share/fixture.txt',
    ])
    expect(result.inputParts).toEqual([
      { type: 'localImage', path: '/Users/example/Desktop/escaped screenshot.png', detail: 'high' },
    ])
  })

  it('labels visual inputs for composer chips', () => {
    expect(contextInputLabel({ type: 'localImage', path: '/tmp/capture.png', detail: 'high' })).toBe('capture.png')
    expect(contextInputLabel({ type: 'image', url: 'https://example.com/capture.png?raw=1', detail: 'high' })).toBe('capture.png')
    expect(contextInputLabel({ type: 'image', url: 'data:image/png;base64,AAAA', detail: 'high' })).toBe('Inline image')
  })

  it('creates visual preview sources for composer attachment chips', () => {
    expect(localPathToMediaUrl('/Users/example/Desktop/smoke image.png')).toBe('cranberri-media://local/?path=%2FUsers%2Fexample%2FDesktop%2Fsmoke%20image.png')
    expect(attachmentPreviewFromPath('/Users/example/Desktop/smoke.png')).toEqual({
      src: 'cranberri-media://local/?path=%2FUsers%2Fexample%2FDesktop%2Fsmoke.png',
      label: 'smoke.png',
    })
    expect(attachmentPreviewFromPath('/Users/example/Desktop/notes.txt')).toBeNull()
    expect(visualInputPreview({ type: 'localImage', path: '/Users/example/Desktop/capture.jpg', detail: 'high' })).toEqual({
      src: 'cranberri-media://local/?path=%2FUsers%2Fexample%2FDesktop%2Fcapture.jpg',
      label: 'capture.jpg',
    })
    expect(visualInputPreview({ type: 'image', url: 'data:image/png;base64,AAAA', detail: 'high' })).toEqual({
      src: 'data:image/png;base64,AAAA',
      label: 'Inline image',
    })
    expect(visualInputPreview({ type: 'text', text: 'Not visual' })).toBeNull()
  })
})
