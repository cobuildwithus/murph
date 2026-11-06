# Message-based runner idle deadline

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Expire hosted conversation warmth ten minutes after the latest accepted user message without losing foreground, background, or device work. Simplify lifecycle policy at its existing owners.

## Success criteria

- Receipt time determines warmth; completion, cleanup, duplicate delivery, replay, and generic RPCs do not extend it.
- Work near expiry is safely completed or durably handed off; stale cleanup cannot stop a successor.
- Checkpoint and provider-effect ordering, admission, and write-fence invariants remain intact.
- Background-only runs do not earn conversation warmth.
- Focused race tests, affected typechecks, complexity review, and relevant runtime proof pass.

## Scope and constraints

Public runtime, container lifecycle, corresponding contracts, tests, and owner docs. No production mutation or new scheduler service. Prefer deletion and reordering over extra state and abstractions. Use synthetic examples only.

## Product UX

Outcome: predictable retention and reliable processing.
Entry: a hosted user message establishes the warmth deadline.
Journeys: normal conversation, late new message, long user turn, background/device work crossing expiry, background-only run, failed checkpoint, stale stop callback, and cold recovery.
Proof: composed admission, expiry, checkpoint, stop, and recovery scenarios.
Status: completed

The warmth deadline is not a termination deadline for accepted work. Existing
foreground durability batching, checkpoint publication, real work, platform
scheduling latency, and uncertain health can delay physical shutdown. No fresh
conversation grace period starts when that work completes.

## Tasks

1. Ask ReviewGPT to challenge the design and implement the smallest safe change as an attachment patch.
2. Inspect and integrate the candidate in the isolated task checkout.
3. Run focused tests, affected typechecks, and relevant runtime proof.
4. Review complexity, privacy, rollout skew, and owner docs; close the plan and commit scoped work.

## Decisions

- Replace completion-based warmth rather than introducing another activity tracker.
- Generic platform inactivity cannot represent user-message receipt time.
- Preserve necessary durability barriers and foreground batching; challenge cleanup-only timer resets.
- ReviewGPT's patch cannot weaken accepted-work or ownership invariants.

## Verification

- Cloudflare entrypoint, runner, invocation, completion-callback, and local race-harness suites: 352 tests passed after updating obsolete default/probe expectations.
- Installed Containers SDK scheduling/readiness suite: 13 tests passed, including persisted schedules, generic activity independence, callback recovery, and object replacement.
- Ten affected assistant-runtime suites: 434 tests passed, including receipt propagation, private/group replay, checkpoint ordering, empty probes, later admission, and a real snapshot restore into a fresh vault.
- Focused diagnostic, image, shutdown, failed-checkpoint, and restored-successor journeys across six additional suites: 38 tests passed.
- Standby allocation and invocation transport-recovery suites: 108 tests passed.
- Changelog server-rendering suite: 10 tests passed.
- Cloudflare, assistant-runtime, and Web typechecks passed.
- `pnpm complexity:diff` passed: entrypoint complexity debt decreased by two and runtime debt decreased by two. The largest existing functions did not grow. Remaining large functions retain their existing work/fencing responsibilities; broader extraction is outside this fix.
- `git diff --check` passed. Parent review covered every changed source owner, test boundaries, receipt provenance, native scheduler behavior, completion fencing, privacy, and rollout compatibility.

Focused test entrypoints were root Vitest with
`apps/cloudflare/vitest.node.workspace.ts`,
`apps/cloudflare/vitest.containers-helper.config.ts`, and
`apps/web/vitest.config.ts`; runtime tests used the package's `vitest.config.ts`.
The documented app-directory changelog command found no tests. The existing
Frog entries `20260911184822-documented-changelog-test` and
`20260912202546-changelog-focused-test` already cover it; the repository-root
command passed after the ordinary generation step. No new friction entry was
needed.

## Implementation and review

ReviewGPT supplied the implementation patch and explained its design. Local
review removed a redundant default, an empty condition, repeated self-message
checks, and a duplicate background wait path. The existing checkpoint timing
helper and wakeable wait remain the owners. Local verification corrected stale
expectations and replaced an incomplete recovery fixture with actual snapshot
bytes and restored cursors.

Deleted completion-time settlement state, heartbeat renewal, pending-wake warm
retention, early-activity retention, empty-probe rearming, and the matching test
harness probe variant. Reused the existing activity callback, child health,
Containers SDK schedule storage, lifecycle lock, interaction generation, and
completion/stop fences. No new dependency, service, queue, environment option,
or canonical database state was introduced. The SDK schedule is derived
execution-cleanup state at the existing RunnerContainer owner.

The release-note item is `2026-09-14/message-based-idle-window`. Its source PR
list is empty because this task produces a local commit; attach the actual PR
provenance when a PR is opened.

## Deployment and remaining evidence

Deploy the Worker consumer before promoting the image. Old children retain
active-work protection but receive no idle warmth from an unknown receipt.
New children temporarily expose the previous health key as an alias of the
same receipt watermark for old Workers. Remove that alias after the supported
Worker rollback floor advances. Physical stops round up to SDK whole-second
precision and can be delayed by platform scheduling or safe draining.

No Web/Temporal protocol change, production mutation, deployment, push, or PR
was performed. Full hosted-local provider/Temporal journeys and live deployed
stop timing were not run. The separate PR delivery path still needs its
risk-routed final ReviewGPT and required exact-head CI. The implementation
changes scheduling and deterministic ownership, not model prompts or tool
schemas; no new real-model invocation was needed for the local proof.
Completed: 2026-09-14
