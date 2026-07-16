# Remove hosted usage-gate callback

## Goal

Remove the verified-unused hosted Web usage-gate compatibility callback while
preserving current member-access admission, mailbox gating, usage recording,
and usage-limit notice behavior.

Success criteria:

- `/api/internal/hosted-execution/usage/gate` no longer exists in the hosted
  Web application.
- The route-only test and current compatibility claims are removed.
- Current admission owners, `/usage/record`, usage notices, and the Cloudflare
  fail-closed 404 regression remain unchanged.
- Durable docs record Cloudflare/runner #587-or-newer as the permanent rollback
  floor for a Web deployment that omits the callback.
- Focused verification, doc gardening, stale searches, diff checks, and the
  truthful diff-aware lane pass.

## Scope

- In: the legacy Web callback route, its focused test, and five current docs
  that still describe the retired callback or its rollout compatibility.
- Out: published `HostedAiUsageAllowDecision` exports, member-access logic,
  mailbox admission, usage recording, usage notices, and the Cloudflare 404
  regression.

## Constraints

- Work only in the isolated `agent/remove-hosted-usage-gate` worktree.
- Preserve unrelated active work and ledger rows.
- Keep the solution deletion-first; do not add a replacement route, shim, or
  compatibility adapter.
- Do not expose secrets, private identifiers, or local user paths in artifacts.
- Do not commit, push, open a PR, or start ReviewGPT until the parent task
  explicitly advances the work to that layer.

## Plan

1. Delete the Web callback route and focused route test.
2. Replace current compatibility claims with the permanent #587 rollback floor
   and direct current ownership model.
3. Run focused Web and Cloudflare regressions, doc gardening, stale searches,
   `git diff --check`, and `pnpm test:diff`.
4. Inspect the final diff and hand the uncommitted worktree back to the parent.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
