import type {
  CodexActivityItemStatus,
  CodexImageGenerationActivityDetail,
  CodexImageViewActivityDetail,
  CodexWebSearchActivityDetail,
} from '@/shared/codex'
import { typeStyle } from '../../lib/typography'
import { markdownMediaSourceFromUrl } from './MarkdownMedia'
import { ActivityDisclosure, ActivityPayload, activityPreview, hasActivityValue } from './ActivityDisclosure'

type SearchImageDetail = CodexWebSearchActivityDetail | CodexImageViewActivityDetail | CodexImageGenerationActivityDetail

function searchTitle(detail: CodexWebSearchActivityDetail, status: CodexActivityItemStatus): string {
  if (status === 'failed' || status === 'declined') return 'Web search failed'
  if (detail.action?.type === 'openPage') return status === 'running' ? 'Opening page' : 'Opened page'
  if (detail.action?.type === 'findInPage') return status === 'running' ? 'Finding in page' : 'Found in page'
  return status === 'running' ? 'Searching the web' : 'Searched the web'
}

export function SearchImageActivity({ detail, status }: { detail: SearchImageDetail; status: CodexActivityItemStatus }) {
  const failed = status === 'failed' || status === 'declined'
  if (detail.type === 'webSearch') {
    const action = detail.action
    const query = detail.query || (action?.type === 'search' ? action.query : null)
    const preview = query || (action?.type === 'findInPage' ? action.pattern : null) || (action && 'url' in action ? action.url : null)
    const hasDetails = hasActivityValue(query) || (action?.type === 'search' && hasActivityValue(action.queries))
      || (action?.type === 'openPage' && hasActivityValue(action.url))
      || (action?.type === 'findInPage' && (hasActivityValue(action.url) || hasActivityValue(action.pattern)))
    return (
      <ActivityDisclosure title={searchTitle(detail, status)} preview={preview ? activityPreview(preview) : undefined} failed={failed} emptyLabel={!hasDetails ? 'No search details' : undefined}>
        {hasDetails ? (
          <>
            <ActivityPayload label="Query" value={query} />
            {action?.type === 'search' && <ActivityPayload label="Related queries" value={action.queries} />}
            {action?.type === 'openPage' && <ActivityPayload label="Page" value={action.url} />}
            {action?.type === 'findInPage' && <><ActivityPayload label="Page" value={action.url} /><ActivityPayload label="Pattern" value={action.pattern} /></>}
          </>
        ) : undefined}
      </ActivityDisclosure>
    )
  }

  const generation = detail.type === 'imageGeneration' ? detail : null
  const view = detail.type === 'imageView' ? detail : null
  const sourceCandidates = [view?.path, generation?.result, generation?.savedPath]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const renderableSource = sourceCandidates
    .map((value) => ({ value, source: markdownMediaSourceFromUrl(value) }))
    .find((candidate) => candidate.source?.kind === 'image')
  const sourceValue = renderableSource?.value ?? sourceCandidates[0]
  const source = renderableSource?.source ?? null
  const renderedGenerationResult = Boolean(generation?.result && renderableSource?.value === generation.result)
  const generationFailed = failed || generation?.generationStatus?.toLowerCase() === 'failed'
  const title = generation
    ? generationFailed ? 'Image generation failed' : status === 'running' ? 'Generating image' : 'Generated image'
    : failed ? 'Image view failed' : status === 'running' ? 'Viewing image' : 'Viewed image'
  const hasDetails = Boolean(sourceValue) || hasActivityValue(generation?.revisedPrompt) || Boolean(generation?.savedPath)
  const preview = generation?.revisedPrompt?.trim() || generation?.savedPath?.trim() || sourceValue

  return (
    <ActivityDisclosure title={title} preview={preview ? activityPreview(preview) : undefined} failed={generationFailed} emptyLabel={!hasDetails ? 'No image details' : undefined}>
      {hasDetails ? (
        <>
          {source?.kind === 'image' && (
            <figure className="min-w-0">
              <img src={source.src} alt={generation?.revisedPrompt?.trim() || 'Activity image'} loading="lazy" className="max-h-80 max-w-full rounded object-contain ring-1 ring-app-border/70" />
              {!source.originalUrl.startsWith('data:') && (
                <figcaption className={`${typeStyle({ role: 'metadata', tone: 'tertiary' })} mt-1 break-all`}>{source.originalUrl}</figcaption>
              )}
            </figure>
          )}
          <ActivityPayload label="Prompt" value={generation?.revisedPrompt} />
          <ActivityPayload label="Result" value={renderedGenerationResult ? undefined : generation?.result} />
          <ActivityPayload label="Saved path" value={generation?.savedPath} />
          <ActivityPayload label="Path" value={view?.path} />
        </>
      ) : undefined}
    </ActivityDisclosure>
  )
}
