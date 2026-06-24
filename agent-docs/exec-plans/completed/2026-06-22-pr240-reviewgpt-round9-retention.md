# PR 240 ReviewGPT round 9 retention fixes

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve ReviewGPT round-9 findings for PR 240 with the smallest changes in
  existing inbox rebuild and hosted snapshot cleanup owners.

## Success criteria

- Runtime rebuild preserves deterministic parser projections for available and
  retention-expired attachments.
- Parser job replay is an explicit rebuild decision, with hosted rebuilds not
  creating undrained jobs that pin media.
- A successful hosted checkpoint directly deletes the replaced V2 snapshot
  object when it is no longer current.
- Focused tests and required verification pass.

## Scope

- In scope:
  - Inbox rebuild parser projection hydration and parser-job replay API.
  - Hosted direct-R2 snapshot replacement cleanup on successful checkpoint CAS.
  - Focused tests for both regressions.
- Out of scope:
  - New cleanup scheduler, queue, database, or R2 lifecycle mechanism.
  - Broad parser pipeline redesign.

## Constraints

- Default to deletion and radical simplicity.
- Preserve existing ingestion parser enqueue behavior.
- Do not expose local identifiers or secret material in committed artifacts.

## Progress

- Implemented inbox rebuild changes:
  - Hydrate parser projections from deterministic parser manifests for both
    available and retention-expired attachments.
  - Try parser manifests newest-to-oldest until one validates, so a torn newer
    attempt does not hide an older valid transcript.
  - Make parser-job replay an explicit rebuild option.
  - Preserve pending/running parser jobs for replayed captures and delete only
    non-replayed stale captures.
- Implemented hosted snapshot cleanup changes:
  - Verify replaced V2 snapshot refs belong to the bound user before cleanup.
  - Record retry evidence before direct replaced-object deletion.
  - Return a cleanup failure only when both direct deletion and retry evidence
    fail.
- Required local audit passes completed:
  - Security/privacy: accepted stale-head snapshot namespace finding and fixed;
    final rerun found no medium-or-higher findings.
  - Coverage-write: added running parser-job preservation proof.
  - Deep-review: accepted and fixed replaced-snapshot retry evidence and torn
    parser-attempt fallback findings.

## Verification

- Passed:
  - `pnpm --dir packages/inboxd test -- idempotency-rebuild inbox-media-retention inboxd-runtime-kernel-coverage`
  - `pnpm --dir packages/parsers test -- parsers`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-outbound.test.ts packages/inbox-services/src/inbox-app/types.ts packages/inbox-services/src/inbox-services/state.ts packages/inboxd/src/indexing/parser-derivatives.ts packages/inboxd/src/indexing/persist.ts packages/inboxd/src/kernel/sqlite.ts packages/inboxd/test/idempotency-rebuild.test.ts packages/inboxd/test/inbox-media-retention.test.ts packages/inboxd/test/inboxd.test.ts packages/parsers/test/parsers.test.ts`
  - `pnpm test:smoke`
  - `pnpm docs:drift`
  - `pnpm --dir packages/contracts test:artifacts`
  - `git diff --check`
Completed: 2026-06-22
