# Junction summary completeness

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve omitted Junction activity, sleep, profile, and cycle summary facts as bounded canonical vault events without retaining full provider arrays or dense samples.

## Success criteria

- Sleep latency lands in minutes from documented seconds.
- Activity average, walking-average, and minimum heart rate plus low/medium/high intensity duration land as distinct summary observations; the existing aggregate uses the same correct unit conversion.
- Profile gender remains distinct from biological sex and lands without fabricated numeric meaning.
- Dated cervical-mucus, intermenstrual-bleeding, progesterone-test, contraceptive, and sexual-activity facts land with bounded qualifiers and stable identities; predictions remain evidence-only.
- Focused importer tests prove validation, replay behavior, and the real core persistence path with no sample rows.
- Compatibility documentation matches the implemented support.

## Scope

- In scope: Junction summary normalization, canonical event shaping, focused metric definitions needed for query composition, focused tests, and compatibility documentation.
- Out of scope: full timeseries retention, workout streams, provider fetch policy, predicted-cycle promotion, frontend/UI, and unrelated audit gaps.

## Constraints

- Technical constraints: write canonical truth only through the importer-to-core path; retain no full arrays as canonical facts; keep external references stable and bounded; preserve provider labels without diagnosing or inferring.
- Product/process constraints: use the smallest maintainable representation, protect sensitive health semantics, preserve unrelated worktree changes, and complete focused tests plus typecheck before handoff.

## Risks and mitigations

1. Risk: Junction duration fields can be confused across seconds and minutes.
   Mitigation: use explicit seconds-path conversion and pin representative large values in tests.
2. Risk: categorical gender/cycle facts could be encoded as misleading numeric observations.
   Mitigation: use a typed note field for reported gender and the existing categorical-measurement convention for sparse dated cycle facts, with the provider meaning in bounded qualifiers.
3. Risk: same-day categorical records overwrite one another.
   Mitigation: include normalized result/detail tokens in bounded external-ref facets and prove replay idempotency.

## Tasks

1. [x] Add scalar activity and sleep normalization with unit-safe metric definitions.
2. [x] Add honest bounded profile and cycle categorical mappings.
3. [x] Extend normalizer and real-core round-trip/replay tests.
4. [x] Update compatibility documentation and run focused verification.

## Decisions

- Preserve the existing aggregate activity-minutes metric while adding independent intensity buckets.
- Keep predicted cycles evidence-only.
- Keep this lane at the canonical vault boundary. The existing health-metrics catalog already recognizes sleep latency and average heart rate; widening the public wearable activity summary for the new provider-specific scalars is a separate product API decision.
- After merging the resource-policy foundation, keep `packages/contracts/src/junction-resources.ts` as the sole resource inventory/policy owner. The importer only re-exports its derived resource sets and owns summary field normalization.

## Verification

- Commands to run: `pnpm --dir packages/importers test -- device-providers-junction.test.ts`; `pnpm --dir packages/importers typecheck`; focused health-metrics tests/typecheck if its catalog changes.
- Expected outcomes: all focused tests and typechecks pass, canonical import writes no sample rows, and replay produces no duplicate categorical facts.

## Completion evidence

- `pnpm --dir packages/importers test -- device-providers-junction.test.ts` — 15 files and 385 tests passed, including canonical core roundtrip and exact replay no-op.
- `pnpm --dir packages/importers typecheck` — passed.
- `pnpm --dir packages/contracts test` — 37 files and 280 tests passed after the resource-policy merge; generated schema artifacts verified.
- `pnpm --dir packages/contracts typecheck` — passed.
- `pnpm --dir packages/device-syncd test -- junction-resource-catalog.test.ts junction-provider.test.ts` — 47 files and 973 tests passed, including the sole-owner resource-catalog invariant.
- `pnpm --dir packages/device-syncd typecheck` — passed.
- `git diff --check` and direct identifier scan of all changed files — passed.
Completed: 2026-08-11
