import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GitFileStatus } from '@/shared/git'
import { ChangeList } from './ChangeList'

const STATUSES: GitFileStatus['status'][] = [
  'added',
  'untracked',
  'deleted',
  'modified',
  'renamed',
  'conflict',
  'staged',
  'tracked',
]

describe('ChangeList', () => {
  it('renders every file state as meaningful semantic status text', () => {
    const status = STATUSES.map((fileStatus) => ({
      path: `${fileStatus}/file-${fileStatus}.ts`,
      status: fileStatus,
    }))
    const html = renderToStaticMarkup(
      <ChangeList
        status={status}
        statusLoading={false}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />,
    )

    for (const fileStatus of STATUSES) expect(html).toContain(`>${fileStatus}<`)
    expect(html.match(/type-status/g)).toHaveLength(STATUSES.length)
    expect(html).not.toContain('text-micro')
  })

  it('lets an unbroken diagnostic wrap without shrinking below status text', () => {
    const diagnostic = `Failed:${'a'.repeat(180)}`
    const html = renderToStaticMarkup(
      <ChangeList
        statusLoading={false}
        error={new Error(diagnostic)}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />,
    )

    expect(html).toContain(diagnostic)
    expect(html).toContain('type-status')
    expect(html).toContain('[overflow-wrap:anywhere]')
  })
})
