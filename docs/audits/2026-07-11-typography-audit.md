# Cranberri typography audit

Date: 2026-07-11
Audited commit: `3643fff` (`feat(ui): complete app-wide polish pass`)
Scope: production Electron renderer, main-process browser inspection, installed UI dependencies, light and dark themes, and runtime smoke surfaces. The ignored `roadmap/` prototype and test-only specimen markup are excluded.

## Executive verdict

Cranberri has a real typography system, not a collection of arbitrary pixel values. The app uses one responsive seven-step UI scale, one configurable code size, one configurable terminal size, three deliberate weights, and semantic color tokens. The recent polish pass also made the settings hierarchy and chat user/assistant size consistent.

It is not fully standardized yet. The main weaknesses are cascade escapes and role drift:

1. `text-app-text-subtle`, dark `text-app-danger`, several status badges, and selectable accent/button pairings fail WCAG AA for small text.
2. Xterm ANSI colors contain near-invisible light-on-light and dark-on-dark combinations.
3. CodeMirror, the diff viewer, Mermaid, Shiki, Sonner, and native browser tooltips each own some typography outside the semantic system.
4. Markdown headings are flattened to body text, and unlabelled fenced code bypasses the configured code size.
5. `micro` can become 9px and is used for meaningful status text, not merely decorative metadata.
6. Fixed line-height utilities (`leading-5`, `leading-6`, `leading-7`, `leading-relaxed`) partially defeat the responsive scale.
7. Equivalent headings, empty states, errors, menus, search fields, and status labels use different roles across workspaces.

## Method and coverage

- Read all typography foundations, shared primitives, text-bearing renderer components, browser inspection code, and installed dependency styles.
- Static census: 65 production TSX files scanned; 45 contain directly detectable visible text; 181 literal visible text nodes and 282 text-bearing props/placeholders/tooltips were catalogued.
- Broader source search included dynamic text, shared class constants, inherited styles, `sr-only` text, native `title` tooltips, and dependency-generated text.
- Eight parallel audit agents returned independent reviews of foundations, chat, shell, right rail, settings/overlays, dependency-controlled content, contrast, and runtime coverage; a ninth census assignment was superseded by the local generated census.
- `npm run package:dir` passed.
- Fresh Electron UAT passed in both smoke modes: `fresh` and `repo`.
- 40 fresh runtime screenshots were inspected from `/tmp/cranberri-typography-audit-20260711` across light/dark, wide/narrow, chat, browser, files, diff, agents, tools, GitHub, processes, terminal, settings, menus, dialogs, and toasts.

The current smoke suite validates behavior and layout existence, not computed typography or pixel diffs. Font-size endpoints and many failure/loading/streaming states remain a test gap.

## Foundations

### Families

| Surface | Source font family | Effective ownership |
|---|---|---|
| App UI/body/`font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif` | Cranberri CSS; actual face depends on OS |
| App mono/`font-mono` | `"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace` | Cranberri CSS |
| CodeMirror and code preview | App mono stack | Cranberri metrics; library syntax styling |
| Diff content | Library `monospace` at fixed 12px | `react-diff-viewer-continued` |
| Terminal | `SFMono-Regular, Menlo, Monaco, "Courier New", monospace` | Xterm config; diverges from app mono stack |
| Mermaid | Hard-coded duplicate of the UI stack | Mermaid-generated SVG |
| Toasts | Sonner system-sans rules | Sonner overrides part of app configuration |
| Embedded web page | Page CSS, web fonts, and Chromium fallback | External page, intentionally outside app system |
| Native `title` tooltip/media controls | Chromium/macOS | Not app-controllable |

There is no `@font-face`; Cranberri ships no font files. Source: `src/renderer/index.css:5-10`.

### Semantic scale

Values are `font-size / line-height` in pixels at every allowed Interface setting.

| Utility / role | 11 | 12 | 13 | 14 default | 15 | 16 |
|---|---:|---:|---:|---:|---:|---:|
| `text-micro` | 9/13 | 9/13 | 9/13 | 10/14 | 11/15 | 12/16 |
| `text-caption` | 10/14 | 10/14 | 10/15 | 11/16 | 12/17 | 13/18 |
| `text-xs` / label | 11/14 | 11/14 | 11/15 | 12/16 | 13/17 | 14/18 |
| `text-sm` / UI | 12/18 | 12/18 | 12/19 | 13/20 | 14/21 | 15/22 |
| `text-base` / prose | 13/20 | 13/20 | 14/21 | 15/22 | 16/23 | 17/24 |
| `text-lg` / title | 15/20 | 15/20 | 15/21 | 16/22 | 17/23 | 18/24 |
| `text-xl` / display | 18/26 | 18/26 | 19/27 | 20/28 | 21/29 | 22/30 |

- `text-code`: configurable 8-24px, default 12px, line-height `1.55` (18.6px at default).
- Xterm: configurable 8-24px, default 13px; library line-height factor is `1.0`, so cell height remains font/platform dependent.
- Unclassed text inherits the browser root at 16px/24px and does not respond to Interface size.
- Interface settings 11px and 12px currently resolve to the same complete semantic scale because of clamps.
- No semantic token equals the nominal 14px Interface default; the common UI token is 13px.

Sources: `src/renderer/index.css:8-24`, `tailwind.config.js:10-19`, `src/shared/settings.ts:13-15`.

### Weight and spacing

Production text intentionally uses:

| Weight | Meaning | Observed uses |
|---:|---|---|
| 400 | body, rows, descriptions, inputs, metadata | dominant |
| 500 | controls, compact headings, names, selected/status emphasis | 47 source occurrences |
| 600 | page/dialog/panel headings and approval title | 13 source occurrences |

No production `font-bold`, negative tracking, or letter-spacing utility was found. Letter spacing is the browser/font default (`normal`/0). Markdown `<strong>` and Xterm bold can still synthesize 700 through content/dependency behavior.

### Shared control roles

| Primitive | Family | Size/line | Weight | Color/state |
|---|---|---|---:|---|
| Compact button | UI | caption | 500 | semantic tone; disabled 40% opacity |
| Small/default button | UI | xs | 500 | semantic tone; disabled 40% opacity |
| Medium button | UI | sm | 500 | semantic tone; disabled 40% opacity |
| Field | UI | sm | inherited 400 unless parent overrides | primary text, subtle placeholder |
| Compact field | UI | xs | inherited | primary text, subtle placeholder |
| Icon button | inherited UI | no visible text | inherited | muted, primary on hover |
| Menu surface | inherited | component-defined | component-defined | elevated surface |
| Segmented item | inherited | component-defined | inherited | muted, primary when active |

Source: `src/renderer/lib/ui.ts:11-72`.

## Text colors and contrast

Ratios are foreground against `bg / surface / surface-2 / elevated`.

| Token | Dark RGB and contrast | Light RGB and contrast |
|---|---|---|
| `text` | `244 244 245`; 17.16 / 16.28 / 14.42 / 15.45 | `31 32 35`; 15.89 / 15.09 / 13.69 / 16.29 |
| `text-muted` | `166 166 175`; 7.81 / 7.41 / 6.56 / 7.03 | `99 99 108`; 5.80 / 5.51 / 5.00 / 5.95 |
| `text-subtle` | `116 116 126`; **4.08 / 3.87 / 3.43 / 3.67** | `137 137 147`; **3.38 / 3.21 / 2.91 / 3.46** |
| `success` | `74 222 128`; 10.82 / 10.27 / 9.10 / 9.75 | `21 128 61`; 4.89 / 4.65 / **4.22** / 5.02 |
| `warning` | `250 204 21`; 12.32 / 11.68 / 10.35 / 11.09 | `161 98 7`; 4.80 / 4.56 / **4.14** / 4.92 |
| `info` | `96 165 250`; 7.42 / 7.04 / 6.23 / 6.68 | `37 99 235`; 5.04 / 4.79 / **4.34** / 5.17 |
| `danger` | `220 38 38`; **3.91 / 3.70 / 3.28 / 3.52** | `220 38 38`; 4.71 / **4.47 / 4.06** / 4.83 |
| `mention` | `255 179 179`; 11.09 / 10.52 / 9.32 / 9.99 | `190 24 93`; 5.89 / 5.59 / 5.07 / 6.04 |

Bold values fail 4.5:1 for normal-size text. `text-subtle` is currently real text in header paths, placeholders, repo actions, and code line numbers. Danger is used in at least 22 text-bearing class sites.

### Accent/button matrix

| Accent | Dark button text | Light button text | Notable failure |
|---|---:|---:|---|
| Green | 8.03 | 5.02 | light `/88` hover 4.04-4.16 |
| Blue | **3.68** | 5.17 | dark default fails; light hover 4.18-4.31 |
| Orange | 6.65 | 5.18 | light hover 4.27-4.40 |
| Rose | **3.67** | 4.70 | dark default and light hover fail |
| Violet | **4.23** | 5.70 | dark default fails |

The right-rail agent count uses micro accent text on a translucent accent surface; several light accents and dark blue/rose/violet are also below 4.5:1 there.

## Static usage census

Counts are class-token occurrences, not rendered-node counts; shared constants and dynamic concatenation can make the true count slightly higher.

| Token | Count | Interpretation |
|---|---:|---|
| `text-app-text-muted` | 215 | Most common color; the app is metadata-heavy |
| `text-app-text` | 104 | Primary text |
| `text-xs` | 103 | Most common explicit size |
| `text-caption` | 81 | Dense metadata/control text |
| `text-sm` | 74 | Main UI labels/body |
| `font-medium` | 47 | Controls and compact emphasis |
| `text-app-danger` | 22 | Errors/statuses; dark contrast issue |
| `text-micro` | 20 | Meaningful statuses as well as metadata |
| `font-mono` | 20 | Paths, versions, code metadata |
| `font-semibold` | 13 | High-level headings |
| `text-app-text-subtle` | 5 | Small real text and placeholders |
| `text-base` | 3 | Chat prose, plus shared classes |
| `text-code` | 6 | Code/editor/diff wrappers |

The ratio of muted to primary color declarations is roughly 2:1. Runtime screenshots confirm that this makes narrow rails visually quieter than chat, but it also flattens status and metadata hierarchy.

## Complete surface inventory

Unless noted, all UI roles use the app UI family and weight 400. Values below are default `font-size/line-height`.

### Global shell, workspace, and repo rail

| Component / text element | Typography | Color/state |
|---|---|---|
| `App` root | inherited 16/24 only for unclassed text | primary |
| Header brand | sm 13/20, 600 | primary |
| Header active repo path | mono caption 11/16 | subtle |
| Header no-repo fallback | UI caption 11/16 | subtle |
| Workspace tab label | xs 12/16 | primary active; muted inactive; primary hover |
| Workspace empty/loading copy | sm 13/20 | muted |
| Repo rail heading | xs 12/16, 600 | primary |
| Repository row | sm 13/20 | primary active; muted inactive; primary hover |
| Session title | xs 12/16 | primary |
| Session recency | micro 10/14 | muted |
| Pinned/Recent headings | caption 11/16, 500 | muted |
| Session loading/empty/show-more | caption 11/16 | muted |
| Session load error | caption 11/16 | danger; raw white on hover |
| Repo/session menu item | xs 12/16 | primary; danger for delete |
| Rename dialog title | sm 13/20, 600 | primary |
| Rename dialog description | xs 12/16 | muted |
| Rename input | sm 13/20 | primary; subtle placeholder |
| Usage heading/rates | xs 12/16, heading 500 | primary; reset muted; low value danger |
| Usage details/history | caption 11/16 | labels muted, values primary, errors danger |
| Health heading/status | xs 12/16, 500 | primary plus semantic status color |
| Health check detail | caption 11/16 and micro 10/14 | muted/status semantic |
| Confirm dialog title | sm 13/20, 600 | primary |
| Confirm body | xs 12/**20 fixed** | muted |
| Confirm error | xs 12/16 | danger |
| Confirm actions | xs 12/16, 500 | shared button tones |

Evidence: `Header.tsx`, `Workspace.tsx`, `RepoRail.tsx`, `UsageMeter.tsx`, `ConfirmDialog.tsx`.

### Chat transcript and rich responses

| Text element | Typography | Color/state |
|---|---|---|
| New-thread empty state | xs 12/16 | muted |
| User message | base 15/**28 fixed**, 400 | primary on surface-2 bubble |
| Assistant response | base 15/**28 fixed**, 400 | primary |
| Streaming assistant fallback | same 15/28, plain whitespace text | primary |
| Working/reasoning toggle | xs 12/16 | muted; primary hover |
| Expanded reasoning/system text | sm 13/**20 fixed** | muted |
| System error | sm 13/**20 fixed** | danger on danger/8 |
| Approval title | xs 12/16, 600 | primary |
| Approval description | xs 12/16 | muted |
| Response action labels | no visible text | native `title`/ARIA only |
| Paragraphs/lists | inherit assistant 15/28 | primary; list markers muted |
| Markdown `h1`-`h6` | **inherit assistant 15/28, 400** | primary; flattened by preflight |
| Blockquote | inherit 15/28 | muted |
| Markdown table body | sm 13/20 | primary |
| Markdown table header | sm 13/20, 500 | primary |
| External/internal links | inherit 15/28 | mention |
| Inline code | mono 0.92em (13.8px at default), inherited line | primary |
| Mention/plugin/skill pill | UI 0.92em, 500 | mention |
| Tagged fenced code | mono code 12/18.6 | Shiki token colors |
| Untagged fenced code | fallback pre sm 13/24; child inline 0.92em | primary; bypasses code setting |
| Code preview caption | caption 11/16 | muted |
| Code truncation/line count | micro 10/14 | muted |
| Code line numbers | code 12/18.6 | subtle |
| Markdown media caption | caption 11/16 | muted |
| Mermaid loading/error | xs 12/16 | muted/danger |
| Mermaid diagram labels | Mermaid default 16px, library weights/lines | generated theme colors |

`tool` is a valid message role but has no dedicated transcript branch, so tool messages receive assistant Markdown typography and response actions.

Evidence: `chat/Transcript.tsx`, `chat/TranscriptList.tsx`, `chat/MarkdownContent.tsx`, `chat/mention-pill.tsx`, `editor/CodePreview.tsx`, `chat/MermaidDiagram.tsx`, `chat/MarkdownMedia.tsx`.

### Composer, menus, chips, and transient chat controls

| Text element | Typography | Color/state |
|---|---|---|
| Composer input/ghost | sm 13/**20 fixed** | primary; actual textarea text transparent behind ghost |
| Composer placeholder | sm 13/20 | muted |
| Approval trigger | xs 12/16 | muted; primary hover |
| Model trigger | xs 12/16 | muted/primary by state |
| Approval/Add section heading | caption 11/16, 500 | muted |
| Approval/Add item title | sm 13/20 | primary |
| Approval/Add item description | caption 11/16 | muted |
| Model menu section heading | xs 12/16 | muted |
| Model option/title | xs 12/16 | primary |
| Model description | micro 10/14 | muted |
| Speed description | xs 12/16 | muted |
| Skill autocomplete heading | caption 11/16, 500 | muted |
| Skill command title/description/source/status | sm 13/**20 fixed** | primary/muted; hierarchy mainly color |
| Attachment/context chip | caption 11/16 | primary; icon muted |
| Context tooltip heading/body | xs 12/16 | muted/primary |
| Context tooltip token count | caption 11/16 | muted |
| Goal/Plan pill | xs 12/16 | primary |
| Voice, add, context, send/stop buttons | no visible text | ARIA/native tooltip only |

Evidence: `ChatWindow.tsx`, `chat/AddMenu.tsx`, `chat/ApprovalSelector.tsx`, `chat/ModelSelector.tsx`, `chat/AttachmentChips.tsx`, `chat/ContextWindowIndicator.tsx`, `chat/GoalModePill.tsx`, `chat/PlanModePill.tsx`.

### Right rail: files, diff, agents, tools, GitHub, processes

| Surface / text element | Typography | Color/state |
|---|---|---|
| Top rail tabs | xs 12/16 | primary active; muted inactive |
| Agent count badge | micro 10/14, 500 | accent on accent/14 |
| Files/Agents panel heading | xs 12/16, 600 | primary |
| Bottom panel heading | xs 12/16, 500 | primary |
| Empty Files/Diff state | sm 13/20 | muted |
| Changed folder | sm 13/20, 500 | primary |
| Changed file | sm 13/20 | primary |
| File status/count badge | micro 10/14, status often 500 | semantic status / muted count |
| All-files tree | sm 13/20 | primary; folders lose changed-view emphasis |
| Diff toolbar path | xs 12/16, 500 | primary |
| Diff additions/deletions | micro 10/14, 500 | success/danger |
| Diff menu item | xs 12/16 | primary; disabled 40% |
| Go-to-line label/buttons | caption 11/16, 500 | muted / shared tone |
| Go-to-line field | xs 12/16 | primary; subtle placeholder |
| Tracked-file editor | mono code 12/18.6 | app text + external syntax colors |
| Changed-file diff content | generic mono **12/19.2 fixed** | dependency colors; ignores code setting |
| Agent group heading/count | caption 11/16, heading 500 | muted |
| Agent name | xs 12/16, 500 | primary |
| Agent role/status | micro 10/14 | muted; meaning mostly icon color |
| Agent summary | caption 11/16 | muted |
| Agent error/message field | xs 12/16 | danger / primary with subtle placeholder |
| Tools ready count/group | caption 11/16, group 500 | muted |
| Tool name | xs 12/16, 500 | primary |
| Tool availability/description | caption 11/16 | muted; status dot semantic |
| Tool detail description | xs 12/**20 fixed** | primary |
| Tool detail labels/values | caption 11/16 | muted/primary; version mono |
| GitHub repo name | sm 13/20, 500 | primary |
| GitHub branch/sync | mono caption 11/16 / UI caption | muted |
| GitHub subsection/item title | xs 12/16, 500 | primary |
| GitHub subtitle/state/meta | caption 11/16 and micro 10/14 | muted |
| Process command | mono caption 11/16 | primary |
| Process kind/PID/port/cwd | micro 10/14 | muted |
| Process stale warning | caption 11/16 | muted with warning icon |
| Commit dialog title | sm 13/20, 600 | primary |
| Commit description/label | xs 12/16, label 500 | muted/primary |
| Commit fields | sm 13/20, **inherits 500** | primary; unintended parent inheritance |
| Rail loading/empty/error | varies xs 12/16, sm 13/20, caption 11/16 | muted or danger inconsistently |

Equivalent panel headings currently vary among xs/600, xs/500, and caption/500. Equivalent loading/empty/error states span three sizes and inconsistent semantic colors.

Evidence: `RightRail.tsx`, `right-rail/RailShell.tsx`, `ChangeList.tsx`, `FileTree.tsx`, `DiffViewer.tsx`, `DiffStats.tsx`, `DiffOptionsMenu.tsx`, `AgentList.tsx`, `AgentRow.tsx`, `ToolsPanel.tsx`, `tool-row.tsx`, `tool-details.tsx`, `GitHubPanel.tsx`, `ProcessesPanel.tsx`, `CommitDialog.tsx`.

### Settings modal

| Text element | Typography | Color/state |
|---|---|---|
| Modal title "Settings" | sm 13/20, 600 | primary |
| Sidebar item | sm 13/20 | muted; primary active/hover |
| Settings page title | lg 16/22, 600 | primary |
| Page description | sm 13/20 | muted |
| Section heading | sm 13/20, 600 | primary |
| Section description | xs 12/16 | muted |
| Settings row label | sm 13/20 | primary |
| Settings row help | caption 11/16 | muted |
| Disclosure title/status | sm 13/20 / caption 11/16 | primary/muted |
| General connection status | xs 12/16, 500 | success |
| Native select | sm 13/20 | primary |
| Appearance segments/size label | sm 13/20 | muted/primary selected |
| Appearance pixel output | mono sm 13/20 | primary |
| Accent swatch | no visible text | ARIA label only |
| Tools search | xs 12/16 | primary/subtle placeholder |
| Tool filter/group | caption 11/16, 500 | muted |
| Tool name/status/help | xs 12/16, 500 / caption 11/16 | primary/muted |
| Extensions tab | caption 11/16, 500 | muted/primary |
| Extensions search | sm 13/20 | primary/subtle placeholder |
| Extension title | sm 13/20 | primary |
| Extension description | caption 11/16 | muted |
| Extension version/state | micro 10/14 | muted/success |
| Updates channel | sm 13/20 | muted/primary selected |
| Updates field/help | xs 12/16 | muted; path mono |
| Build status/detail | sm 13/20, 500 / caption 11/16 | primary/muted; semantic icon |
| Diagnostics summary | sm 13/20, 500 | primary |
| Diagnostics metadata | caption 11/16 | muted |
| Diagnostic row title/detail/status | sm 13/20 / caption 11/16 / micro 10/14, 500 | primary/muted/semantic |
| Diagnostic path label/value | xs 12/16 / mono caption 11/16 | muted/primary |
| Shortcut command | sm 13/20 | primary |
| Shortcut keys | mono caption 11/16 | muted |
| About version | sm 13/20 | primary |
| About locality/help | xs/sm | muted |

Settings is the most internally coherent workspace. Drift remains between equivalent searches (Tools xs, Extensions sm), status semantics, and modal/page title hierarchy.

Evidence: `SettingsDialog.tsx`, `settings/settings-page.tsx`, `GeneralSettings.tsx`, `AppearanceSettings.tsx`, tool catalog components, `CodexResourcesSection.tsx`, `UpdatesSettings.tsx`, `DiagnosticsSection.tsx`.

### Browser, terminal, command palette, and toasts

| Surface / text element | Typography | Color/state |
|---|---|---|
| Browser address | xs 12/16 | primary; unstyled placeholder uses Tailwind gray |
| Browser error | xs 12/16 | danger |
| Browser paused/frozen | sm 13/20 | muted |
| Viewport label | micro 10/14 | muted |
| Capture heading/empty | xs 12/16, heading 500 | primary/muted |
| Captured page prose | mono caption 11/**17.875** (`1.625`) | muted |
| Inspection metadata label/value | xs 12/16 / mono caption 11/16 | muted/primary |
| Browser menu group/item | caption 11/16, 500 / xs 12/16 | muted/primary |
| Embedded page text | arbitrary | site/Chromium controlled |
| Terminal toolbar path | xs 12/16 | muted |
| Terminal status | caption 11/16 | muted/warning/danger; ready icon success |
| Terminal search | xs 12/16 | primary; subtle placeholder |
| Terminal canvas | divergent mono 13px, xterm line factor 1.0 | explicit ANSI palette |
| Terminal error | sm 13/20 | danger |
| Command palette input/empty | sm 13/20 | primary/muted placeholder |
| Command group/loading | xs 12/16, heading 500 | muted |
| Command item title/help | sm 13/20 / xs 12/16 | primary/muted |
| Toast title | Sonner system sans, effective ~13px, 500, line 1.5 | Sonner primary color |
| Toast description | Sonner system sans, effective ~12px, 400, line 1.4 | Sonner color, not reliable app muted |
| Toast action | fixed 12px, 500 | Sonner button colors |
| Native icon tooltip | OS/Chromium-defined | not app-controllable |

Browser address and terminal search inputs have placeholders but no explicit visible label or `aria-label`; the browser placeholder falls to Tailwind `#9ca3af`, about 2.48:1 on the light background.

Evidence: `BrowserWindow.tsx`, `TerminalWindow.tsx`, `terminal-theme.ts`, `CommandPalette.tsx`, `AppToaster.tsx`, Sonner CSS.

## Dependency-controlled typography

| Dependency | Cranberri controls | Dependency/content controls | Audit risk |
|---|---|---|---|
| CodeMirror | family, base size, 1.55 line, surfaces, gutters | syntax theme, search UI percentages, highlights | default syntax theme is light-only; search controls can shrink to 5.6-9.6px at allowed code sizes |
| Shiki | code family/size/line/container | token colors and optional token styles | explicit GitHub light/dark themes are selected correctly |
| React diff viewer | outer wrapper | fixed 12px, 1.6em, generic mono, diff colors | ignores Code size and app mono family |
| Xterm | configured size, terminal stack, palette | cell metrics, bold/attributes, ANSI/truecolor from PTY | severe ANSI contrast failures; `minimumContrastRatio` remains 1 |
| Mermaid | major theme colors and duplicated UI stack | default 16px, generated weights/lines/derived colors | ignores Interface scale |
| Sonner | requested classes | higher-specificity family, line-height, colors, 12px action text | toast typography escapes semantic system |
| Radix | app classes | structure/positioning only | generally controlled |
| React Markdown/GFM | renderer classes | parsing | heading reset is not countered |
| Embedded browser | Cranberri chrome and inspection display | page CSS/fonts/content | intentionally external; inspect payload omits line-height/spacing/decoration |

KaTeX packages are installed but not used by the renderer, so no math typography is currently rendered.

## Prioritized findings

### Critical accessibility and legibility

1. **Repair semantic color contrast.** `text-subtle`, dark danger, tinted danger alerts, light file-status badges, and several accent/button combinations fail 4.5:1.
2. **Replace the terminal ANSI palette and set Xterm `minimumContrastRatio`.** Light white/brightWhite are about 1.05/1.03:1; dark black/brightBlack are about 1.05/1.36:1. Several bright colors also fail.
3. **Do not use `micro` for decision-relevant state.** It reaches 9px and currently labels extension state, diagnostic state, agent roles/status, model descriptions, process metadata, and file badges.

### System consistency

4. **Create explicit semantic roles:** overlay title, panel title, group label, row title, metadata, status, empty, error, field label, and prose heading. Migrate equivalent surfaces to them.
5. **Restore Markdown hierarchy.** Define `h1`-`h6`, tagged and untagged fenced-code handling, tool-message presentation, and semantic error/compaction treatment.
6. **Use responsive line roles instead of fixed `leading-*`.** Chat 28px, reasoning/composer/dialog/tool-detail 20px, raw code 24px, and captured prose 1.625 currently drift as Interface size changes.
7. **Unify code surfaces.** CodeMirror, diff viewer, Shiki preview, fallback code, Mermaid source, and Xterm should deliberately declare which size setting and family they follow.
8. **Bring dependency CSS under the token layer.** Configure CodeMirror dark syntax/search, override diff metrics, override Sonner specificity, consume CSS family variables in Xterm/Mermaid, and configure `tailwind-merge` for custom text sizes.

### Polish and resilience

9. **Normalize menu and status hierarchy.** Model menu headings/descriptions, skill autocomplete, right-rail status rows, and settings searches are visibly inconsistent.
10. **Prevent inherited weight and narrow-rail overflow.** Commit inputs inherit 500; raw paths/errors lack emergency wrapping; Files/Tools headers are fragile at 288px and Interface 16px.
11. **Label text inputs accessibly.** Add explicit visible or ARIA labels for browser address and terminal search instead of relying on placeholders.
12. **Add typography regression UAT.** Capture Interface 11/16, Code 8/24, Terminal 8/24, light/dark, 900px width, long labels, streaming/error/loading/empty states, Markdown specimens, stacked toasts, and dependency surfaces.

## Runtime observations

- User and assistant messages are visibly the same size in both themes.
- Settings page, section, row, and help hierarchy is coherent and stable in light/dark.
- At 900px width, chat prose remains readable, but right-rail micro/caption metadata becomes disproportionately small.
- Command palette and dialogs are stable; dialog titles are only one semantic step from body rows and feel weak for overlays.
- Tools/Agents/GitHub use compact readable rows at default size, but status hierarchy relies heavily on color/dots and muted text.
- Browser quick search now remains above the BrowserView and is legible; disabled rows are intentionally low-opacity.
- Terminal ready output is crisp at 13px, but only the default foreground was exercised; ANSI failures are conditional on colored output.
- `settings-tools-dark.png`, `model-selector.png`, and `settings-updates-dark.png` were partial/cropped smoke captures; their complete companion captures and source styles were used for conclusions.

## Verification gaps

The audit did not claim visual coverage for:

- Interface 11px and 16px endpoints.
- Code and terminal 8px/24px endpoints.
- CodeMirror search UI at minimum code size.
- Streaming, expanded reasoning, approval error, compaction error, and every Markdown heading/table/quote state in one specimen.
- All ANSI colors in both terminal themes.
- Every Extensions/GitHub subview and every loading/failure/empty combination.
- Native tooltips and actual fallback font selection, which are OS-controlled.

These gaps do not invalidate the static findings; they define the next UAT matrix.

## Source map

Primary foundations:

- `src/renderer/index.css`
- `tailwind.config.js`
- `src/renderer/lib/ui.ts`
- `src/renderer/state/appearance.ts`
- `src/shared/settings.ts`

Primary surface owners:

- Shell: `Header.tsx`, `Workspace.tsx`, `RepoRail.tsx`, `UsageMeter.tsx`
- Chat: `ChatWindow.tsx`, `chat/Transcript.tsx`, `chat/MarkdownContent.tsx`, chat menus/chips, editor previews
- Right rail: `RightRail.tsx`, `right-rail/*`
- Settings: `SettingsDialog.tsx`, `settings/*`, `CodexResourcesSection.tsx`, `DiagnosticsSection.tsx`
- Browser/terminal: `BrowserWindow.tsx`, `TerminalWindow.tsx`, `terminal-theme.ts`, `src/main/browser.ts`
- Global overlays: `CommandPalette.tsx`, `ConfirmDialog.tsx`, `AppToaster.tsx`, `UpdateResultToast.tsx`

Generated audit evidence:

- Static census: `/tmp/cranberri-typography-census.json`
- Fresh screenshots: `/tmp/cranberri-typography-audit-20260711/`
