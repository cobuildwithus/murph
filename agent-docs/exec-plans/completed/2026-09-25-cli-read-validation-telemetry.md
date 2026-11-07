# CLI read validation telemetry

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Implementation

- [x] Trace schemas, original-error emission, normalized reader and automation-list proof.
- [x] Add only `knowledge show: slug` and `event payload-schema: kind, for` to the production allowlist.
- [x] Extend finite-field/privacy tests, native timing parity controls and actual old-reader compatibility proof.
- [x] Update the validation owner's bounded natural-traffic query and consumer-first rollout guidance; index this plan.

## Parent-verified evidence

Verified on candidate `3aa393b50837fd9a3ae1def4a0ad97389f75b9ec`:

- Runtime-state CLI timing Vitest: 31 passed, 3 unrelated opt-ins skipped. Actual
  old-reader compatibility passed with
  `MURPH_CLI_READ_VALIDATION_COMPAT_BASE=85d536703736f3553105e01120f5560a25b732e4`.
- Real CLI timing subprocess suite: 28 passed, including exact timing-on/off
  outputs/exits, no filesystem writes and no provider calls.
- Runtime-state and CLI typechecks passed. `complexity:diff` passed: maximum 19
  unchanged, 0 hotspots. `docs:drift` and diff whitespace checks passed.
- Before the patch: 169 assistant diagnostics/profile/transport tests passed,
  with 3 intentional skips; this is baseline evidence, not an exact-head rerun.
- Documented bounded aggregate SQL ran successfully; both selected validation
  singletons still have absent field details, as expected before rollout.

Parent used the Frog skill/list and reused existing capture-friction issue #3213.

## Cause and delivery ownership

Only two telemetry allowlist entries change runtime source; behavior is unchanged,
so no live-model journey was needed. Production validation causes remain unresolved
until natural failed traffic carries finite detail. Null/absent detail is not
proof of health. No merge, deployment or production mutation occurred in this handoff.

[PR #3707](https://github.com/cobuildwithus/murph/pull/3707) is the durable owner of
final ReviewGPT, exact-head CI and delivery/deployment status; consult the PR for
final gate results. Local verification does not assert those gates passed.
The parent owns archival via `scripts/finish-task` after final review and gates resolve.
Completed: 2026-09-25
