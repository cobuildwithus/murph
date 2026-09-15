# Preserve sleep coverage and explicit receipt timestamps

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Keep explicit naps from satisfying group nightly sleep coverage, and preserve
  an explicit import receipt timestamp instead of replacing it with older data.

## Success criteria

- Synthetic nap-only records remain visible in personal sleep queries but do not
  populate shared sleep duration, stages, or timing. Main and legacy unknown-type
  sleep remain available independently per provider.
- An explicit valid observedAt wins over backfill windows and event timestamps;
  missing/invalid receipt times retain deterministic fallback and replay identity.
- Focused regressions fail before the changes and pass afterward; relevant
  typechecks and parent diff review pass.

## Scope

- In scope: query metric provenance, existing group projection, receipt timestamp
  resolution, composed synthetic regressions, owner docs and release note.
- Out of scope: provider transport, source selection policy, production repairs,
  prompt changes, new share schemas, permission changes, and database migrations.

## Constraints

- Canonical records and consent stay with their existing owners. Add no dependency,
  background work, extra read, or provider call. Existing group snapshots converge
  through ordinary replacement after a personal checkpoint.
- Preserve all personal nap records and legacy sleep with unknown type. Derive
  group points from the stored wearable summaries, which already retain sleepType.
- Keep fixture values, dates, and identifiers synthetic.

## Risks and mitigations

1. Removing naps globally would alter personal history and unrelated vitals.
   Mitigation: carry optional sleepType context and filter only group sleep
   duration/stage scopes and sleep timing.
2. Changing receipt fallback could churn replay identity or rewrite old evidence.
   Mitigation: change only explicit valid observedAt precedence; preserve the
   existing fallback and canonical writers, and test content identity on replay.
3. Older cached MetricPoints lack the added context.
   Mitigation: group per-source queries rebuild points on read from wearable
   summaries already containing sleepType; test against a previously built store.

## Tasks

1. Add composed sleep projection and explicit receipt-time regressions; prove red.
2. Correct metadata propagation, group filtering, and receipt precedence.
3. Run focused suites/typechecks, document contracts, and review the full diff.
4. Close this plan and create the scoped commit.

## Decisions

- Use optional MetricPoint context rather than expanding the share wire schema.
- Receipt replay identity remains content-derived; fallback is intentionally
  deterministic and is not an arrival-time guarantee.
- Product UX effort: Patch.
- Outcome: no nap-only nightly score and honest explicit receipt timestamps.
- Reaches: consented group sleep updates; personal sleep and import evidence.
- Proof: real query/export/freshness composition with synthetic canonical records,
  plus importer tests covering explicit times and replay fallback.

## Verification

- Assistant runtime: focused sleep coverage regressions and existing vault-share
  projection tests.
- Query: wearable metric projection regressions.
- Importers: wearable evidence tests and timestamp replay regressions.
- Typecheck query, importers, and assistant-runtime; run complexity and doc checks.
- Product UX walkthrough: Ready. A nap remains personally visible while group
  nightly scopes stay missing; a later main sleep fills duration, stages, and
  timing. Independent provider values and unknown sleep types remain eligible.

## Results

- Added nine synthetic regression cases. Before the fix, seven sleep cases and
  the explicit receipt-time case failed; the unknown-type compatibility case
  already passed. All now pass.
- Assistant runtime: 148 tests passed across
  `vault-share-sleep-coverage.test.ts` and `vault-share-projection.test.ts`.
  The cache regression removes sleepType from stored MetricPoint JSON before
  exercising the real per-source query, export, and freshness owners.
- Query: 48 tests passed across `wearables-normalized-surfaces.test.ts`,
  `wearables-sleep-session-anchor.test.ts`, and
  `query-projection-provider-scope.test.ts`.
- Importers: 88 tests passed across `wearable-evidence.test.ts`,
  `device-providers.test.ts`, and `device-provider-snapshot-validation.test.ts`.
  These include canonical import/replay coverage as well as receipt preparation.
- Changelog: 10 production archive rendering tests passed in
  `apps/web/test/changelog-page.test.tsx`.
- Package typechecks passed for query, importers, and assistant-runtime;
  `pnpm --dir apps/web typecheck` also passed.
- `pnpm complexity:diff --base HEAD` passed with no increased complexity debt.
  Existing hotspots retain their behavior and branch counts; metadata uses the
  existing context compactor without adding a conditional to the metric owner.
- `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check` passed.
- Parent review checked the full source, regression, documentation, and release
  note diff. No new dependencies, database/network calls, share-wire shapes, or
  permission changes. Fixtures contain only synthetic data.
- No real-model run: acceptance is deterministic export/receipt behavior;
  prompts, tool schemas, model decisions, and reply policy are unchanged.
- Completion scope is a local scoped commit. PR creation was not requested;
  external ReviewGPT and exact-head CI remain part of any later PR completion.
  The release-note fragment has no source PR attribution until a PR exists.
- Existing delivered group snapshots change at the next ordinary projection
  refresh. The patch does not reconstruct historical arrival timestamps or
  establish an upstream source-data discrepancy's cause.
Completed: 2026-09-15
