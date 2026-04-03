# Cloudflare Bundle iMessage Boundary

## Goal

Fix the hosted Cloudflare deploy blocker where Wrangler pulls `@photon-ai/imessage-kit` into the bundle and fails on `bun:sqlite`, without weakening deploy behavior or adding bundler-specific hacks.

## Scope

- Add narrow public `@murphai/inboxd` entrypoints for hosted runtime helpers.
- Update hosted/runtime imports to use those narrow entrypoints instead of the root inbox surface.
- Verify the Cloudflare app and re-run the Wrangler dry run to confirm the `bun:sqlite` failure is gone.

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep imports on declared workspace package entrypoints only.
- Prefer removing the dependency edge over deploy-command workarounds.

## Plan

1. Add or use narrow inbox public entrypoints for runtime/email/telegram/linq helpers.
2. Update assistant-runtime and assistant-core hosted-facing imports to avoid the inbox root barrel.
3. Run Cloudflare verification and a Wrangler dry run.
4. Commit the fix if the deploy blocker is resolved.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
