---
title: "feat: Normalize plugin mention rendering"
created_at: "2026-07-07"
plan_type: "feat"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# feat: Normalize plugin mention rendering

## Goal Capsule

- **Objective:** Make plugin and skill references inside chat text feel first-class by rendering markdown link tokens like `[@Computer](plugin://computer-use@openai-bundled)` and `[$compound-engineering:ce-plan](...)` as compact mention pills instead of raw URLs.
- **Authority:** Preserve the exact stored/sent message text; this plan only changes presentation.
- **Execution profile:** Lightweight UI renderer work in the chat transcript/composer path.
- **Stop conditions:** Stop if rendering requires changing Codex input payloads, plugin execution semantics, or persisted thread formats.

---

## Product Contract

### Problem Frame

Cranberri already supports invoking plugins and skills through Codex, but the chat transcript exposes plugin links as raw markdown syntax in user messages. That makes plugin use feel bolted on compared with the Codex app, where tool/plugin references read as intentional mentions.

### Requirements

- R1. Chat text renders plugin links whose label starts with `@` and href starts with `plugin://` as mention pills using the label as the visible text.
- R2. Chat text renders skill links whose label starts with `$` as mention pills, including local `SKILL.md` links.
- R3. Rendering preserves the original message content for copy, replay, and Codex send payloads.
- R4. Existing inline code, assistant markdown, user bubbles, and composer ghost text keep their current behavior.

### Scope Boundaries

- The work does not add a plugin picker, plugin execution state, new Codex protocol fields, or runtime plugin discovery.
- The work does not rewrite historical messages in storage; historical text simply renders with the new presentation.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Keep this in the existing inline renderer. `src/renderer/components/chat/Transcript.tsx` already owns `formatInlineCodexText`, which is used by user messages, reasoning text, and composer ghost text through `src/renderer/components/ChatWindow.tsx`.
- KTD2. Treat mention rendering as presentation-only. The parser recognizes a narrow subset of markdown links and returns React elements, while callers continue passing the original raw string to send/copy paths.
- KTD3. Keep normal assistant markdown on `ReactMarkdown`. Assistant final answers already use the richer markdown renderer; the new mention logic should be available through custom anchor rendering there only when the link is a plugin/skill mention.

---

## Implementation Units

### U1. Add first-class mention pills to inline chat rendering

- **Goal:** Render plugin and skill markdown links as compact pills in user bubbles, reasoning text, and composer ghost text.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** None
- **Files:** `src/renderer/components/chat/Transcript.tsx`, `src/renderer/components/chat/Transcript.test.tsx`
- **Approach:** Extend `formatInlineCodexText` to parse inline code and markdown links in one pass. Add a narrow helper that classifies `plugin://` links with `@` labels and skill-style `$` labels as mention links, then renders them with a shared pill class. Leave unmatched links as their literal markdown text in the inline renderer so the composer remains a faithful text preview.
- **Patterns to follow:** Reuse the existing inline-code renderer and the current test style in `src/renderer/components/chat/Transcript.test.tsx`.
- **Test scenarios:** Render `[@Computer](plugin://computer-use@openai-bundled)` and assert the visible output contains `@Computer` without the `plugin://` URL. Render `[$compound-engineering:ce-plan](/Users/example/SKILL.md)` and assert the visible output contains the skill label without the local path. Render a normal markdown link and assert it remains literal in inline mode. Render inline code and assert code styling still appears.
- **Verification:** Focused transcript tests pass and no call sites need to change their send/copy payload behavior.

### U2. Normalize mention links inside assistant markdown output

- **Goal:** Apply the same plugin/skill pill presentation when assistant final answers include plugin or skill links.
- **Requirements:** R1, R2, R4
- **Dependencies:** U1
- **Files:** `src/renderer/components/chat/Transcript.tsx`, `src/renderer/components/chat/Transcript.test.tsx`
- **Approach:** Update the markdown `a` component to classify plugin/skill mention links before external-link handling. Plugin links should render as non-navigating pills because `plugin://` is not a browser destination. Skill file links should also render as pills instead of external anchors.
- **Patterns to follow:** Keep GitHub/external anchor behavior unchanged for regular URLs.
- **Test scenarios:** Render assistant markdown with a plugin mention and a GitHub PR link; assert the plugin mention is visible without an href while the GitHub link still preserves its `href`.
- **Verification:** Focused transcript tests pass and existing markdown-link behavior remains covered.

---

## Verification Contract

- `npx vitest run src/renderer/components/chat/Transcript.test.tsx`
- `npm test`
- `npm run build`
- Manual UAT in the dev Electron app: a prompt containing `[@Computer](plugin://computer-use@openai-bundled)` displays as a compact `@Computer` mention in the user bubble/composer instead of raw markdown.

---

## Definition of Done

- Plugin and skill markdown-link tokens render as first-class mention pills in inline chat text.
- Original raw text is still what Codex receives and what copy actions preserve.
- Normal links, inline code, assistant markdown, and copy buttons do not regress.
- Tests and production build pass.
