# Simplify and ship the state-machine fixes

Status: completed
Created: 2026-11-06
Updated: 2026-11-07

## Outcome and scope

Ship the confirmed Murph and iOS state-machine corrections with one maintained
inventory, regression proof and the smallest correct ownership boundaries.
Backend production delivery is complete. Native source and the test-only
follow-up are on main. Implementation, focused verification and documentation
are complete; linked PRs and runs own final hosted verification and merge status.

On 2026-11-07 the user explicitly limited native delivery to main and excluded a
new TestFlight upload. Signing setup, archive, upload and App Review submission
are outside this task. Preserve unrelated edits; no rollback or secret extraction
is authorized by this plan.

## Architecture decisions

- Reuse the existing game lock and GameEvent foreign-key lock for reminder
  carry-over. Remove the redundant player-lock query; retain two immutable
  per-field choice facts because older clients can omit every-day selection.
- Retain diagnostic conditional writes and one shared durable-winner reread:
  losing a transition must not report readiness or completion.
- Keep iOS retained-cache writes at accepted game merges, removals and partial
  posts. Generic Home presentation no longer writes the cache; account, safety,
  redaction and absent-cache tombstone guards remain intact.
- Use one native reminder lifecycle: unloaded, loading, ready, saving or failed.
  Loading and saving own their attempt UUID; a save reserves ready state before
  its first await. This removes reminder-specific global-revision checks and
  prevents edits of defaults, stale-account publication and overlapping writes.
- Keep one cross-cutting review per repository: validated Murph ReviewGPT and the
  selected independent native local review. Native checks ran locally through
  Xcode under the user's explicit authorization.

## Verified delivery receipts

| Boundary | Receipt |
| --- | --- |
| Murph source | [PR #4733](https://github.com/cobuildwithus/murph/pull/4733) merged as `1a78f7429bc8e26b353fc7a0d36c1663cad4983b`; 37 successful checks and three intentional skips. Final ReviewGPT PASS on `8367d979f29a4f0587ce4c6ecf3d8290f477a8d6`, with no qualifying findings. The accepted response was recovered through its exact capture receipt after interruption; no duplicate review was submitted. |
| Native source | [PR #478](https://github.com/cobuildwithus/murph-ios/pull/478) merged as `2813742176f595a0fe9e762360df230119808926`; 288 local unit tests, both test builds, formatting and independent review passed. Two focused UI executions covered ready/loading/saving/failed on SE and Pro Max, with eight committed screenshots; exact-head hosted visual and review-tooling checks passed. |
| Managed Web | Production deployment `7616806236` and [Temporal admission #42340015400](https://github.com/cobuildwithus/murph/actions/runs/42340015400) succeeded for public source `1a78f7429bc8e26b353fc7a0d36c1663cad4983b`. |
| Protected runner/Worker | [Production rollout #42340618753](https://github.com/cobuildwithus/murph-cloud/actions/runs/42340618753) succeeded for that same public source. Delivery, auth, runner and deployed endpoint smoke passed. Final live verification records gradual rollout, `release_converged=true` and 100% Worker traffic on the new release. |
| Post-deploy contract migrations | [Run #42340678910](https://github.com/cobuildwithus/murph/actions/runs/42340678910) succeeded. |

Focused backend proof includes activation 14, ordinary reminders 28, diagnostics
16 and warmup 6 tests, plus Web/Cloudflare typechecks, lint and complexity checks.
The activation proof covers both lock orders, optional fields, feature-disabled
saves and constant query count at 1,000 games. The upstream parser fix needed no
local patch; its parser/inbox suites passed 54 and 25 tests. The shared
[state-machine inventory](../../references/app-state-machines.md) owns the
failure schedules, transition tables and detailed evidence.

## Final delivery evidence

- [iOS PR #480](https://github.com/cobuildwithus/murph-ios/pull/480) merged as
  `132a2279d2709e137290b6850fd580c7e4efe867` after both exact-head checks passed.
  The 79 affected tests and the latest-main test build passed locally. Its
  [full main CI run](https://github.com/cobuildwithus/murph-ios/actions/runs/42342494525)
  owns post-merge product verification; local proof does not imply that result.
- [Murph documentation PR #4734](https://github.com/cobuildwithus/murph/pull/4734)
  owns the final inventory/index update and this archived plan. Diff, drift and
  gardening checks pass. Its hosted checks and guarded merge remain PR-owned
  completion gates, separate from the already verified production delivery.

Physical-device and live native-backend behavior are not represented by simulator
proof. No TestFlight upload is planned or required for the user-approved outcome.
Completed: 2026-11-07
