# chatgpt patch download helper

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Add a repo-local helper that can open an authenticated ChatGPT thread in the managed Chrome session, locate attachment buttons such as `.patch` files, click them, and save the downloaded files into a caller-selected directory.

## Success criteria

- Root `package.json` exposes a direct ChatGPT attachment-download command.
- The helper accepts a ChatGPT thread URL and an attachment selector such as an exact label or pattern.
- The helper uses the existing managed Chrome debug session rather than a separate browser/login flow.
- The example thread `69c71d43-0e38-8330-9df8-c4e10f5bf536` successfully downloads `assistant-unified-final-pass-fixes.patch` into a local output directory.

## Scope

- In scope:
  - one root script for attachment download through managed Chrome
  - root script wiring
  - concise README usage notes
- Out of scope:
  - automatic implementation of downloaded patches
  - true background resumption of the current Codex session
  - broad refactors of existing ChatGPT helper flows outside the minimum needed wiring

## Risks and mitigations

1. Risk: clicking a thread attachment could rely on viewport state or an already-open tab.
   Mitigation: ensure the helper can create/open the target tab, wait for content, and scroll the target button into view before clicking.
2. Risk: attachment downloads could complete in Chrome without a deterministic local path.
   Mitigation: explicitly set the page download behavior to a caller-provided directory and wait for `Page.downloadProgress` completion.
3. Risk: the ChatGPT UI could contain multiple similarly named buttons.
   Mitigation: support exact label matching first and keep the initial behavior narrow.

## Tasks

1. Register the download helper lane in the coordination ledger and keep scope to root tooling files.
2. Add the managed-Chrome attachment-download helper and root package wiring.
3. Document the direct usage briefly in `README.md`.
4. Verify the helper by downloading the example `.patch` attachment from the provided ChatGPT thread.
5. Run required verification commands and report unrelated repo failures separately if they still block green checks.

## Verification

- Direct scenario proof: download `assistant-unified-final-pass-fixes.patch` from the example thread into a local output directory.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Completed: 2026-03-29
