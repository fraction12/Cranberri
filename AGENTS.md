# AGENTS.md — Cranberri

A chat-first desktop coding cockpit for local repo work.

## What this is

Personal tool, not a product. One window: side-by-side Codex chat columns, a right rail showing repo diff/files/issue context, and a bottom terminal drawer. Built so you can stay inside one app while driving Codex through repo changes.

## Stack

- Electron 42 + Vite 7 + React 18 + TypeScript 5
- Tailwind CSS 3 with a fixed dark semantic token layer (`--app-*`)
- `node-pty` + `@xterm/xterm` for terminal
- `simple-git` + `parse-diff` for git status/diff
- `@tanstack/react-query` for async state
- `react-resizable-panels` for layout splits
- Native Linear GraphQL API for issue context (token local, never committed)
- Codex app-server JSON-RPC over stdio for the agent loop

## Constraints

- The repo is **private** on `fraction12/Cranberri`.
- Linear API key is a local secret. Never write it to repo, skills, memory, or tool output.
- Prefer small, focused files. One concern per module.
- Every IPC surface is typed on both sides. Shared types live in `src/shared/`.
- UI components are thin. Business state lives in `src/renderer/state/`.
- Use the semantic token layer for system, light, and dark themes. Do not add a second runtime styling engine.
- No dashboard grids, no drag-and-drop workbench, no rich markdown editor. Chat-first means chat columns dominate.

## Verification

Before committing, run:

```bash
npm run build
```

This runs typecheck + lint + electron-vite production build. Do not push with failing checks.

## Code style

- TypeScript strict mode on.
- ESLint flat config (`eslint.config.js`).
- `zod` for all IPC payloads and persisted state.
- `Promise` return types explicit on preload and main handlers.
- React state: contexts for session-scoped data, React Query for server/repo data.
- Keep components under ~120 lines. Extract lists and heavy markup early.
- Naming: `kebab-case` files, `PascalCase` components, `camelCase` functions.

## Directories

- `src/main/` — Electron main process, IPC handlers, external process wrappers
- `src/preload/` — contextBridge API
- `src/renderer/` — React app, state, components, styles
- `src/shared/` — types and schemas shared across main/preload/renderer

## Writing code

1. If you touch main or preload, update `src/shared/` types and `src/renderer/vite-env.d.ts`.
2. If you add an IPC call, add it to preload, main handler, and shared schema.
3. If you add async repo state, wrap it in `useQuery` with a sensible refetch interval.
4. If you add UI state that needs to survive reload, persist it in `userData/` as JSON via `zod`.

## What to avoid

- Rebuilding generic SaaS shell (auth, workspaces, billing). This is single-user local-first.
- Over-abstracting before the feature works end-to-end.
- Copying all of Nephrite. Steal useful UI and backend code, but adapt it to the chat-first frame.
- Open-sourcing or exposing this repo. It is a private personal tool.

## Git workflow

- Work on `main` for now. No need for feature branches until there's more than one contributor.
- Commit messages: `feat(scope): ...` or `fix(scope): ...`.
- Run `npm run build` before every push.

## Testing

Manual end-to-end testing is acceptable for v1. Automated tests are optional until a module stabilizes. If you add a test, use `vitest` and colocate it near the code under `*.test.ts`.

## Dependencies

Add packages only when they solve a real problem we would otherwise write. Avoid UI polish libraries. Ask before adding anything heavy.

## Agent behavior

Work in small verified increments. Build one end-to-end feature at a time, verify with `npm run build`, commit, then move to the next. Do not leave broken code staged.
