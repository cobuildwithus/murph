# Junction historical backfill retry fixes

Status: completed
Created: 2026-05-25
Updated: 2026-05-25

## Goal

- Fix Junction historical backfill retry completion so the 90-day summary
  recovery is completed only when canonical-bearing summary records arrive, and
  avoid writing empty summary raw snapshots for retry-only backfill attempts.
- Close the adjacent metadata-patch persistence proof gap without allowing
  secret-like fields or raw provider identifiers into account metadata,
  provider-config subject metadata, or legacy stored credential metadata.

## Success criteria

- Empty summary plus non-empty timeseries schedules bounded retry and does not
  mark historical summary backfill complete.
- Profile-only summary schedules bounded retry and does not mark complete.
- Summary resources that can normalize into canonical health facts mark the
  historical summary backfill complete.
- Exhausted retry budget stops retrying.
- Empty historical backfill retries do not call `importSnapshot` for the empty
  summary payload; non-empty backfills still import expected snapshots.
- Metadata merge behavior is covered at the 16-entry cap, override, null
  tombstone, and undefined-retention cases.
- Metadata sanitizer and store tests prove generic secret/token/HMAC/webhook,
  auth/session/credential, misleading hash, and raw provider/account
  identifier keys are dropped before persistence and read-time exposure.

## Scope

- In scope:
- `packages/device-syncd` Junction provider follow-up and tests.
- Shared device-sync metadata sanitizer/merge behavior and tests.
- Out of scope:
- Importer result-count coupling or importer-level retry policy changes.
- Reconcile receipt behavior changes.
- Provider API shape or auth changes.

## Constraints

- Technical constraints:
- Keep retry behavior bounded and metadata-only.
- Keep the historical summary predicate provider-local and independent from
  importer result counts.
- Do not widen raw payload logging or expose provider identifiers.
- Keep existing safe retry metadata (`status`, attempts, windows) accepted.
- Product/process constraints:
- Preserve unrelated working-tree and ledger edits.
- Follow repo verification, audit, and scoped commit flow.

## Risks and mitigations

1. Risk: incorrectly classifying a summary resource as canonical-bearing.
   Mitigation: use an explicit resource allowlist matching current Junction
   normalization support and prove resource categories in provider tests.
2. Risk: changing reconcile evidence retention unintentionally.
   Mitigation: scope empty-summary import skip to historical backfill retry
   decisions only.

## Tasks

1. Inspect current Junction provider/importer snapshot and retry flow.
2. Patch summary-record predicate and empty-backfill summary import order.
3. Add focused Junction provider retry/import tests.
4. Add focused metadata merge tests.
5. Harden metadata sanitizer for generic secret/token/HMAC keys and raw
   identifier keys after security review.
6. Harden provider-config credential subject write/read/preservation paths
   after final audit found a legacy metadata bypass.
7. Run typecheck, package/diff coverage, audits, and final commit flow.

## Decisions

- Use canonical-bearing summary records, not all summary resources and not
  timeseries records, as the historical summary-completion signal.
- Use `null` as the supported metadata clearing value; `undefined` is ignored
  and retains existing metadata.
- Shared metadata sanitization blocks raw ids and generic secret/token keys,
  while preserving only explicit hash/blind-index metadata key shapes for
  non-reversible lookup evidence.
- Provider-config credential `subject` metadata uses the same persisted-key
  policy as connection metadata, including when legacy stored rows are read or
  preserved by hosted hydration.

## Verification

- Commands to run:
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/shared-metadata-security.test.ts test/store.test.ts test/service.test.ts test/junction-provider.test.ts` passed.
- `pnpm --dir packages/device-syncd test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/metadata.ts packages/device-syncd/test` failed in an unrelated CLI Murph Age test expecting candidate feature count `8` but receiving `9`; this diff does not touch CLI or Murph Age logic.
- Required completion audits: security/privacy review, coverage-write, and
  task-finish review completed. Security and final-audit findings were resolved;
  the final task-finish audit reported no findings.
Completed: 2026-05-25
