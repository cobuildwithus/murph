# Hosted Effects Port Type Cleanup

## Goal

Remove legacy provider tunnel members from `HostedRuntimeEffectsPort` so the public hosted runtime type only represents Worker-owned capabilities still provided by Cloudflare.

## Constraints

- Preserve current Cloudflare runtime behavior: provider sends, typing, read receipts, and cleanup should use direct hosted provider helpers through `providerFetch`/env, not `effectsPort`.
- Keep Telegram file lookup/download, raw email reads, email send, artifact/browser-vault/mailbox/web-control/usage/log capabilities intact.
- Avoid overlapping edits in active `apps/cloudflare` runner files unless typecheck forces a minimal adjustment.
- Do not touch unrelated dirty worktree files.

## Plan

1. Remove legacy Linq/Telegram/WhatsApp provider tunnel members from `HostedRuntimeEffectsPort`.
2. Update assistant-runtime call sites that still check those members to use direct provider helpers.
3. Remove or rewrite tests that assert the old effects-port provider branches.
4. Run focused verification for `packages/assistant-runtime` and broader typecheck/test-diff as feasible.
5. Run required completion audits, then close the plan or report any dirty-worktree commit blocker.

## Verification

- Pending.
