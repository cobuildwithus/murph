# Prepare consecutive audio messages concurrently

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Reduce preparation latency for consecutive audio messages while preserving ordered mailbox acknowledgement, complete transcript evidence, canonical writes, retries, and the combined reply.

## Success criteria

- Two eligible audio preparations overlap with a fixed concurrency limit of two.
- Canonical writes, evidence publication, pending admission, and watermarks retain mailbox order even when preparation finishes in reverse order.
- Failure, replay, cancellation, and ineligible inputs retain their established behavior.
- Focused tests, package typechecks, and parent review pass.

## Scope

- In scope: consecutive fresh inline direct Linq messages with one audio attachment each, matching conversation and reply context; parser preparation/finalization split; focused regression proof.
- Out of scope: new queues, schemas, dependencies, scheduling services, retry owners, or production mutations.

## Constraints

- Technical constraints: mailbox validation, budget, and watermarks remain owned by mailbox import; raw capture and job claims retain their current owners; parser publication uses existing attempt fences.
- Product/process constraints: synthetic fixtures only; preserve the complete combined reply and established serial paths; validate the returned external patch independently.

## Risks and mitigations

1. Concurrent work can reorder authority or admit incomplete input. Separate preparation from ordered publication and admission, and test reverse completion.
2. Failure or cancellation can orphan work or repeat transcription. Join owned work and prove retry/replay behavior.
3. Added telemetry or helper plumbing can miss consumers. Review all wrappers and log allowlists.
4. Added complexity can exceed the benefit. Keep the path bounded to two eligible inputs and review the source diff for unnecessary machinery.

## Tasks

1. Verify the returned artifact belongs to the submitted request and applies to the supplied base. Complete.
2. Apply the patch and run focused runtime/parser tests and typechecks. Complete.
3. Review the implementation, fix proven issues, and repeat affected checks. Complete.
4. Update durable documentation and package the validated patch in a scoped local commit.

## Decisions

- Use a finite two-input path instead of parallelizing whole mailbox imports.
- Recover the completed ReviewGPT artifact through exact-thread export after normal capture stalls; verify request identity, model, completion marker, and artifact ownership.
- Correct the returned fixture to initialize the real inbox service, assert the actual parser-result artifact, and narrow nullable/discriminated evidence types. No production behavior was changed to satisfy those assertions.
- Keep mailbox lookahead and its one completed sibling inside a batch-local importer; isolate context binding, audio eligibility, and overlap measurement. Reuse the signal value within preparation. The complexity guard passes without suppressions or threshold changes.
- The task delivers a locally validated patch. PR creation, final candidate review/CI, release notes, and rollout are separate work. This patch has a member-visible performance outcome and requires a changelog entry when proposed for release; no public shipped claim is authored for this artifact-only handoff.

## Verification

- Baseline: the existing mailbox conversation/import tests passed (112 tests in two files) before applying the patch.
- Artifact validation: exact-thread identity and completion checks passed; the patch passed `git apply --check` against the supplied base.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-mailbox-audio-preparation.test.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-mailbox-conversation-loader.test.ts test/hosted-runtime-workspace-entrypoint-scheduling.test.ts`: 197 passed.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-workspace-runner.test.ts`: 159 passed.
- `pnpm --dir packages/parsers test`: 101 passed across all eight files, including prepared attempts, worker cancellation, and stale-attempt publication fences.
- `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir packages/parsers typecheck`: passed.
- `pnpm complexity:diff --base 279af3d6f72e2dcea289b693fbc53b8a5d2d91c8`: passed. Existing runtime/mailbox maxima and debt do not increase; conversation import maximum falls from 49 to 38. The new pair import remains a reviewed hotspot at 31, owning finite ordered staging and failure disposition without another queue or lifecycle abstraction.
- `git diff --check`: passed. Added content reviewed for private identifiers and production evidence.
- `pnpm verify:workspace-boundaries` and `pnpm verify:workspace-package-cycles`: passed.
- The remote dependency-isolated harness is supporting evidence, not a substitute for repository checks.

## Product and parent review

- Ready for local patch review: controlled barriers prove two external preparations overlap, reverse completion cannot publish out of order, and a third input cannot exceed the cap. Actual SQLite jobs, raw artifacts, derived transcripts, assistant evidence, pending admission, and combined input selection are exercised.
- Retry and preemption replay preserve completed evidence without another parser call. Malformed, disallowed, sidecar, sequence-gap, different-context, mixed-media, system, and consumed-replay boundaries retain serial behavior. Budget tests exercise the workspace and checkpoint wrappers.
- Foreground cost: at most two existing downloads and two existing capture-scoped parses run concurrently. Connector/provider timeouts and retries remain owned by existing code. Canonical writes, claims, and finalization stay ordered and external work stays outside database transactions.
- Added diagnostic values are bounded numeric metadata accepted by the existing runtime-log parser; no raw context or content is logged. Runtime and parser code ship in the same bundle; there is no persisted schema or cross-version API change.
- Prompt construction, tool contracts, reply policy, and grouping are unchanged. These checks prove preparation and admission behavior, not a measured production speedup or a sampled live-model reply. Production timing remains unmeasured for the new path.
- Parent review covered all changed source, tests, and documentation, including the local simplifications. Final external candidate review and exact-head CI have not run because no PR is part of this task.
Completed: 2026-09-14
