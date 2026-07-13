# Native Codex chat reference

This directory pins the native chat and composer target used by the parity plan.
Visual work must not use "current Codex" or memory as an acceptance target.

## Compatibility pin

| Field | Value |
|---|---|
| Native app | `/Applications/ChatGPT.app` (`com.openai.codex`) |
| Desktop build | `26.707.62119` (`CFBundleVersion` `5211`) |
| Bundled Codex CLI | `codex-cli 0.144.2` |
| Cranberri runtime CLI at capture start | `codex-cli 0.144.0` |
| Compatibility | Protocol-equivalent for the pinned chat surface: generated `ThreadItem` and `ServerRequest` bindings are byte-identical across CLI 0.144.0 and 0.144.2 |
| Operating system | macOS 26.3 (`25D2125`) |
| Display | 2560 x 1664 built-in Retina display |
| Theme | Dark |
| Interface size | Default; no override is persisted in the native desktop configuration |
| Native UI font | Satoshi |
| Target viewports | 1400 x 900 and 900 x 600 CSS pixels |

The native theme and font values come from the `[desktop]` and
`[desktop.appearanceDarkChromeTheme]` sections of the local Codex configuration.
No credentials, prompt history, project paths, or user content are copied into
this reference directory.

## Protocol snapshot

The pinned schema is generated from the app-bundled binary, not the independently
installed CLI:

```bash
/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-ts \
  --experimental \
  --out <temporary-directory>
```

The generated snapshot contains 671 TypeScript files. It is intentionally kept
outside the repository; the conformance ledger records the owned protocol surface
without checking in generated upstream code.

Pinned compatibility hashes:

- `v2/ThreadItem.ts`: `7f911d8aa4046653274d3709afffcdfd4093d9d6c87395287f58c4a754ac4cd2`
- `ServerRequest.ts`: `1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be`

Both hashes match output from the native 0.144.2 binary and Cranberri's 0.144.0
runtime. A future mismatch requires a new compatibility disposition before the
parity baseline can move.

## Capture status

Reference screenshots are not captured yet. Computer Use refuses to control the
host Codex application from a Codex task, so this session cannot produce honest
fixed-state native captures. The implementation may proceed through protocol and
state work, but reference-driven visual styling and a 1:1 claim remain blocked
until the fixed states are captured from outside the host task or supplied by the
user.

`reference-states.json` expands every R2 state across dark and light themes at
1400 x 900 and 900 x 600, for 64 required capture cases. Every blocked entry has
a machine-readable reason and a null asset path. No placeholder image is treated
as native evidence.

Validate the contract and print its capture summary with:

```bash
node scripts/uat/codex-chat-parity-contract.mjs
npx vitest run scripts/uat/codex-chat-parity-contract.test.ts
```

The validator rejects missing pin or replay metadata, undeclared masks, incomplete
matrix coverage, non-synthetic fixture classification, and captured claims whose
PNG asset is absent. Blocked entries do not trigger filesystem asset checks.

To unblock visual work, capture the predeclared synthetic states outside the host
Codex task, place each PNG under this reference directory, and change only the
corresponding matrix entry to `captured` with its relative asset path. The global
policy remains `capture-in-progress` until all 64 entries are captured, then moves
to `captured`.
