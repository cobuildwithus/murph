# Web Internal Mailbox Workspace Routes

Goal (incl. success criteria):
- Add the narrow signed internal `apps/web` callback routes needed by greenfield hosted runtime mailbox/workspace/platform ports.
- Routes stay DTO plumbing only: auth/signature validation, request parsing, store call, parsed response.
- Focused tests prove schema alignment, checkpoint CAS behavior, redacted log/status behavior, payload sidecar fetch, and no plaintext/log leakage.

Constraints/Assumptions:
- Do not edit `apps/cloudflare`.
- Do not delete old hosted-run routes in this wave.
- No `runId`, `committedSeq`, `finalizeRequired`, `peek`, `adopt`, or `source_cursor` in new route names or DTOs.
- Web does not own assistant execution cursors, run adoption/finalization, turn revision, outbox truth, or queue semantics.
- Preserve unrelated dirty-tree edits from active concurrent rows.
- User explicitly requested no commit.

Key decisions:
- Reuse existing `@murphai/hosted-execution` public entrypoints and `apps/web` hosted mailbox/workspace stores.
- Add only minimal contract parser exports if a route contract gap blocks implementation.

State:
- in_progress

Done:
- Read required routing, architecture, security, reliability, verification, and migration docs.

Now:
- Inspect existing contracts, stores, auth helpers, and test patterns.

Next:
- Implement narrow route handlers and focused tests.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: exact existing route helper names until package inspection finishes.

Working set (files/ids/commands):
- `apps/web/app/api/internal/{hosted-mailbox,hosted-workspace,hosted-runtime}/**`
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/test/**`
- `packages/hosted-execution/src/**` only if a minimal parser/route contract gap blocks routes.
