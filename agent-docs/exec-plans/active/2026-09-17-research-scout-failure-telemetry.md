# Research scout failure telemetry

Status: active — implementation authored; parent verification and rollout pending
Created: 2026-09-17
Updated: 2026-09-17

## Goal and scope

Retain exactly `research_scout_invalid_batch_payload`,
`research_scout_invalid_window` and `research_exa_token_missing` in the existing
bounded CLI timing vocabulary. The first two map to private `invalid_input`,
the third to private `unavailable`. These already-owned errors have no stage;
keep timing stage `unknown` and omit absent shell-diagnostic stage.

Synthetic rationale: malformed compact lanes, a reversed publication window and
an empty injected environment are different rejections that currently lose their
codes. This is information preservation, not a proven behavior correction.
Prompts, schemas, handlers, public output/error text, exit semantics, provider
dispatch, authority, retry policy, counts and writes must remain unchanged. No
new event, field, collector, persistence, broad provider catalogue or regex code
admission. Unknown labels stay unknown; no raw inputs or private content belong
in telemetry or this plan. Changelog: not applicable, private telemetry only.

## Owners and decisions

- Portable sender/reader vocabulary: `packages/runtime-state/src/cli-timing.ts`.
  The existing Node sender reads the original error; no sender change is needed.
- Private category reader: assistant-engine `tool-failure-diagnostics.ts`.
  Existing shell readback, engine receiver/profile and hosted usage parsing reuse
  the portable vocabulary; do not fork a schema or change their control flow.
- Canonical contract: `docs/hosted-runtime-log-database.md`, finite CLI failure
  counts and compatible rollout. This plan adds no new operational process.

The supplied comparison base is `202e58578d61`. The author received an archive
without Git history, lockfile, installed dependencies or the patched Incur file;
its relationship to that commit must be confirmed in the parent checkout.

## Execution and verification

1. [x] Read the owners and reproduce the cheapest failing proof before edits:
   the three source codes become `unknown` in the portable normalizer.
2. [x] Add only three exact vocabulary entries and their three private category
   mappings; add regressions to existing runtime-state, CLI and engine tests.
3. [x] Run available author-local checks. The added portable regression failed
   before the change and passed after it. With an environment-only `node:test`
   registration adapter, 27 runtime-state and 10 process/transport tests passed;
   two Git-history tests were skipped. Test bodies and production implementations
   were unchanged. Actual untouched archive producer/normalizer/hosted-reader
   probes preserved calls, failures, phases and tokens across old/new and absent
   evidence; a real loopback probe preserved the three codes after the change.
   These checks are supplemental, not canonical Vitest or real-parser results.
4. [ ] In the confirmed parent base, run the focused commands below with the
   repository Node/pnpm versions and patched Incur. Keep real parser/command
   tests: invalid semantic batch/window and empty-env client produce zero
   provider fetches, one failure, identical diagnostics-on/off output/exit;
   a valid fake-provider neighbor succeeds without a failure diagnostic.
   Preserve privacy, hostile-property bounds, raw events and native accounting.
5. [ ] Run source-owned diff/typecheck/scenario/document gates. No parent, CI,
   deployment or post-rollout result is claimed here. The author's Node was
   22.16.0 rather than the required >=24.14.1; pnpm/dependencies were absent and
   registry access failed. Frog was unavailable before dependency installation.
6. [ ] Consumer-first rollout: update downstream Web/hosted normalizers,
   receiver/profile and private category readers before CLI producers. Verify
   actual pre-admission readers using the base below, not a copied parser.
   Old writers/readers may still yield `unknown`; rollback loses specificity,
   never counts or valid usage. Do not infer recovery of already-lost evidence.
7. [ ] Perform the authorized bounded evidence review below; record only
   synthetic/public-safe conclusions here. Close/archive this plan only after
   actual verification and rollout evidence exists. Any corrective or closeout
   repository edits remain with the implementation author, not a fabricated
   deferred closeout patch.

Focused commands (from the parent repository root; not executed here):

```bash
MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE=202e58578d61 \
  pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage \
  test/cli-timing.test.ts test/cli-timing-process.test.ts
pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage \
  test/cli-timing.test.ts test/research-scout-batch.test.ts
MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE=202e58578d61 \
  pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage \
  test/assistant-tool-failure-diagnostics.test.ts test/cli-timing-profile.test.ts \
  test/cli-timing-transport.test.ts test/device-tool-failure-diagnostics.test.ts
```

Both history-backed research tests must execute, not skip: runtime-state loads
the actual old normalizer; engine loads both actual old hosted and portable
owners. Unknown coalescing must preserve all counts and token accounting; absent
old evidence adds calls without inventing failure observations. New readers must
accept old records and unknown future optional evidence independently.

## Future evidence query and behavior gate

After compatible rollout, choose and freeze one closed 24-hour UTC window,
split into two adjacent non-overlapping 12-hour windows. Use the canonical
bounded usage/profile query over existing `cliTiming.commands`, filter exact
`research scout-batch`, and group each half by exact retained failure code and
stage. Preserve its per-turn/profile deduplication and row caps; do not add
shell diagnostics, overlapping profiles or dynamic-tool counts to this surface.
Keep coverage, command error calls, observed failure counts, absent evidence,
unknowns and drop/truncation accounting separate; narrow a capped window rather
than claiming complete coverage.

Select behavior work only when a finite category is observed and its violated
boundary is deterministically reproduced at the actual source owner. A code is
not proof of agent fault, configuration defect or production cause. Expected
rejections stay expected; singleton observations remain investigated rather than
promoted to behavior work. Valid-call latency/size and unrelated clusters are
out of scope. No production access is authorized by this implementation plan.
