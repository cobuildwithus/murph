# Research scout failure telemetry

## Proven scope and owners

Retain exactly `research_scout_invalid_batch_payload` and `research_scout_invalid_window`
as private `invalid_input`, and `research_exa_token_missing` as private `unavailable`.
The production diff is four lines in two existing finite code tables, not a behavior fix.
Synthetic rationale: invalid compact input/window and missing configuration must remain distinguishable.
Timing stage stays `unknown`; absent shell stage is omitted. Unknown codes/lookalikes stay unknown.
Prompt/schema/handler validation, model/public errors and outputs, exits, dispatch/calls,
retry, authority, counts and writes are unchanged. No new event, field, collector or persistence.
No broad provider catalog or regex labels; no arguments, error text, payloads, tokens or paths escape.
Changelog and live assistant journey: not applicable to private classification-only scope.

- Vocabulary: `packages/runtime-state/src/cli-timing.ts`; existing sender, normalizer and hosted profile reused.
- Private category/shell readback: `packages/assistant-engine/src/assistant-codex/tool-failure-diagnostics.ts`.
- Durable contract and current rollout/query rules: `docs/hosted-runtime-log-database.md`.

## Parent native verification (2026-09-17)

Confirmed pre-admission base: `202e58578d61f940117a954b35cbbf8376b15632`.
Applied implementation SHA256: `d4e3f7a766d2dae7cdaf5a3eb0bec5795d087559cdead76da94f6a89a41e8299`.
Parent ran Node 24.14.1 with installed patched dependencies and inspected the full diff.

| Focused owner suites | Result |
| --- | --- |
| Runtime-state timing/process | 31 PASS; 1 optional old-memory-history SKIP |
| CLI timing/research batch | 30 PASS |
| Engine diagnostic/profile/transport/device | 223 PASS; 2 unrelated optional history SKIP |
| Total | 284 PASS; 3 unrelated optional SKIP |

Both new research history tests executed and passed with `MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE`
set to the full base above, loading actual old portable/hosted readers, not copies.
Old/new readers preserve calls, failures, phases, reports and tokens through unknown coalescing and absent evidence.
Real parser/client proof covers zero external requests for each selected rejection, one failure,
identical diagnostics-on/off output/exit, and a successful valid fake-provider neighbor without failure detail.
Privacy sentinel tests and hostile getter/proxy bounds PASS. Independent synthetic three-code regression:
all three failed before and passed after. Runtime-state, CLI and engine package typechecks PASS.
Complexity PASS: zero new debt, maxima 14 and 19, no hotspots >20.
Logs/privacyguard PASS; docs drift PASS; gardening: 0 issues. These are parent-reported results, not a new run.

## Compatibility and completion

Consumer first: downstream Web/hosted normalizers, receiver/profile and private category readers before CLI producers.
Old readers normalize new codes to `unknown` without losing counts; rollback loses specificity, not valid usage.
New readers accept old records and unfamiliar optional evidence; already-lost classifications are not recovered.
`agent-docs/operations/completion-workflow.md` owns closure: after implementation and final ReviewGPT/parent review,
close via `scripts/finish-task`; apply the deferred historical index row only with that canonical closeout.
Plan closure does not wait for merge, rollout or a post-rollout comparison. Required exact-head CI remains separate.
At this record, draft PR #3538 is open; final ReviewGPT, CI, merge and rollout remain pending; track them in PR/private run evidence.

## Deferred evidence and behavior gate

After compatible, separately authorized rollout, freeze a closed 24-hour UTC interval as adjacent 12h/12h windows.
Query bounded `cliTiming.commands`, exact `research scout-batch`, grouped by exact retained code/stage in each half.
Preserve canonical per-turn/profile deduplication and row caps; do not add shell, overlapping profile or dynamic-tool counts.
Keep coverage, command errors, observed failures, absent evidence, unknowns and drop/truncation counts separate; narrow capped windows.
Select behavior work only for an observed finite category and a deterministically reproduced violated owner boundary.
Codes alone prove no production cause; expected rejections stay expected and singletons remain investigated.
No production access is authorized here; unrelated clusters and valid-call latency/size work remain excluded.
Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
