# Cloudflare-hosted PR design proof

## Goal

Keep frontend PR proof screenshots out of Git while preserving reviewer-readable
desktop and mobile evidence through public Cloudflare Images delivery URLs.

## Scope

- Delete tracked screenshot binaries under `agent-docs/assets/pr-proof/`.
- Require local Cloudflare Images upload and public PR-body URLs in the
  completion workflow.
- Keep Cloudflare credentials local and out of repository files and review
  artifacts.

## Verification

- [x] `pnpm test:frontend-design-proof`
- [x] `pnpm test:diff agent-docs/operations/completion-workflow.md`
- [x] `git diff --check`
- [x] Confirm `agent-docs/assets/pr-proof/` no longer exists.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
Completed: 2026-07-22
