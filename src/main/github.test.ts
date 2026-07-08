import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getGitHubToken, loadLocalGitHubPanelData, loadOctokitPanelDataForRepo, parseGitHubRemote } from './github'

function git(repoPath: string, args: string[]): void {
  execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' })
}

describe('GitHub structured API helpers', () => {
  it('detects GitHub tokens without requiring persisted settings', () => {
    expect(getGitHubToken({ GITHUB_TOKEN: 'github-token' })).toBe('github-token')
    expect(getGitHubToken({ GH_TOKEN: 'gh-token' })).toBe('gh-token')
    expect(getGitHubToken({})).toBeNull()
  })

  it('parses common GitHub remote URL forms', () => {
    expect(parseGitHubRemote('git@github.com:fraction12/Cranberri.git')).toEqual({
      owner: 'fraction12',
      repo: 'Cranberri',
      webUrl: 'https://github.com/fraction12/Cranberri',
    })
    expect(parseGitHubRemote('https://github.com/fraction12/Cranberri')).toEqual({
      owner: 'fraction12',
      repo: 'Cranberri',
      webUrl: 'https://github.com/fraction12/Cranberri',
    })
    expect(parseGitHubRemote('https://example.com/fraction12/Cranberri')).toBeNull()
  })

  it('maps Octokit pull requests and filters pull requests out of issues', async () => {
    const client = {
      repos: {
        get: async () => ({ data: { id: 1, full_name: 'fraction12/Cranberri', private: true, html_url: 'https://github.com/fraction12/Cranberri' } }),
        listBranches: async () => ({ data: [] }),
        listCommits: async () => ({ data: [] }),
        listReleases: async () => ({ data: [] }),
      },
      pulls: {
        list: async () => ({
          data: [{
            id: 10,
            number: 7,
            title: 'Improve panel',
            state: 'open',
            html_url: 'https://github.com/fraction12/Cranberri/pull/7',
            user: { login: 'dushyantgarg' },
            created_at: '2026-07-07T00:00:00Z',
            updated_at: '2026-07-07T01:00:00Z',
          }],
        }),
      },
      issues: {
        listForRepo: async () => ({
          data: [
            { id: 11, number: 8, title: 'Real issue', state: 'open', html_url: 'https://github.com/fraction12/Cranberri/issues/8' },
            { id: 12, number: 9, title: 'PR issue', pull_request: {}, state: 'open' },
          ],
        }),
      },
      actions: {
        listWorkflowRunsForRepo: async () => ({ data: { workflow_runs: [] } }),
      },
    }
    const repoRef = { owner: 'fraction12', repo: 'Cranberri', webUrl: 'https://github.com/fraction12/Cranberri' }

    await expect(loadOctokitPanelDataForRepo(client, repoRef, 'pulls')).resolves.toMatchObject({
      source: 'octokit',
      authenticated: true,
      items: [expect.objectContaining({ title: '#7 Improve panel', author: 'dushyantgarg' })],
    })
    await expect(loadOctokitPanelDataForRepo(client, repoRef, 'issues')).resolves.toMatchObject({
      items: [expect.objectContaining({ title: '#8 Real issue' })],
    })
  })

  it('loads local git fallback data for branches, commits, and tags', async () => {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cranberri-github-local-'))
    git(repoPath, ['init', '--quiet'])
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Local GitHub fallback\n')
    git(repoPath, ['add', 'README.md'])
    git(repoPath, ['-c', 'user.name=Cranberri Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'Initial local commit'])
    git(repoPath, ['branch', 'local-context'])
    git(repoPath, ['tag', 'v0.1.0'])

    await expect(loadLocalGitHubPanelData(repoPath, 'branches')).resolves.toMatchObject({
      source: 'git',
      authenticated: false,
      items: expect.arrayContaining([
        expect.objectContaining({ title: 'local-context', state: 'local' }),
      ]),
    })
    await expect(loadLocalGitHubPanelData(repoPath, 'commits')).resolves.toMatchObject({
      source: 'git',
      items: [expect.objectContaining({ title: 'Initial local commit', author: 'Cranberri Test' })],
    })
    await expect(loadLocalGitHubPanelData(repoPath, 'releases')).resolves.toMatchObject({
      source: 'git',
      items: [expect.objectContaining({ subtitle: 'v0.1.0', state: 'tag' })],
    })

    fs.rmSync(repoPath, { recursive: true, force: true })
  })
})
