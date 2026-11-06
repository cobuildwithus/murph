# ECG identity mismatch diagnostics

## Outcome and boundaries

Distinguish absent normalized voltage-group identity from present-but-unequal
identity in existing ECG binding failure diagnostics. Preserve exact binding,
canonical writes, foreground priority, lifecycle fences and retry behavior.
One bounded numeric field uses the existing event and warning retention.
Older producers omitting the field remain unknown rather than zero.

## Evidence and ownership

Synthetic tests against the current resolver and binding extractor show that
missing, different and additional-component identities have identical counters;
exact identities and equivalent field aliases pass, and corrected responses
recover. This proves the diagnostic gap, not an incorrect binding policy.
The supplied checkout failed the sanctioned storage guard. A successor checkout
was created with the repository worktree helper on a task-owned branch from current main;
the supplied checkout and unrelated work remain preserved.
No open PR covers this diagnostic distinction.

ReviewGPT staging refused its Work surface before sending. The authenticated
fallback probe verified Claude Opus 5.5 (`claude-opus-5-5`), which owns all
production changes, substantive test changes and diagnostic documentation.
The local agent owns reproduction, patch acceptance, verification and delivery.

## Steps

- [x] Verify the diagnostic gap with synthetic inputs and inspect existing owners.
- [x] Receive and inspect the implementation author's exact patch.
- [x] Run focused tests, affected typechecks, complexity and privacy checks.
- [x] Complete local implementation; PR delivery, final ReviewGPT and exact-head CI
  remain explicit external completion gates, recorded in the PR and task handoff.

## Observation and rollout

No behavior change or member-facing changelog. After a separately verified
producer deployment, observe natural failures for 24–72 hours. Classify
missing identity, present-but-unequal identity and absent telemetry separately.
Existing warnings retain 14 days; keep the field if it answers that diagnostic
question, otherwise remove through a reviewed change. Never trigger production
replay, refresh, resync, backfill or provider recovery to collect evidence.

## Local completion evidence

Claude Opus 5.5 authored the accepted patch and its complexity/index correction.
The local agent applied both exact diffs. The baseline passed seven existing ECG
cases; test-only application produced six expected missing-counter failures.
The accepted implementation passed 245 device resource/service tests and 154
hosted maintenance tests. After the branch-free correction, all 58 resource
tests passed again. Eleven existing source-staleness tests also passed.
Both affected package typechecks, complexity guard, docs drift and diff whitespace
checks passed. Complexity debt is unchanged; the nine existing hotspots keep
their current ownership and no broader refactor is justified for this counter.

Parent inspection confirms the counter is incremented only in the existing
provider-matching, requested-instance rejection branch. Both diagnostic boundaries
retain independent finite integer validation; older producers remain unknown.
No added event, persistence schema, dependency, network call, foreground work,
provider-visible prompt change or member-facing behavior. No production
recovery operation was performed. Final review, CI and deployment must not be
inferred from these local results.
Status: completed
Updated: 2026-10-13
Completed: 2026-10-13
