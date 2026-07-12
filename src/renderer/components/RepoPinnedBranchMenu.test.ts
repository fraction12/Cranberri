import { describe, expect, it } from 'vitest'
import { orderedLocalBranchChoices } from './RepoPinnedBranchMenu'
import type { GitRef } from '@/shared/worktrees'

function ref(name: string, kind: GitRef['kind'] = 'local'): GitRef {
  const prefix = kind === 'local' ? 'refs/heads/' : kind === 'remote' ? 'refs/remotes/' : 'refs/tags/'
  return { name, fullName: `${prefix}${name}`, sha: 'a'.repeat(40), kind }
}

describe('orderedLocalBranchChoices', () => {
  it('keeps only local branches and prioritizes the pin followed by the live branch', () => {
    expect(orderedLocalBranchChoices([
      ref('main'),
      ref('feature/chat'),
      ref('release'),
      ref('origin/main', 'remote'),
    ], 'main', 'release')).toEqual([
      { name: 'release', pinned: true, current: false },
      { name: 'main', pinned: false, current: true },
      { name: 'feature/chat', pinned: false, current: false },
    ])
  })
})
