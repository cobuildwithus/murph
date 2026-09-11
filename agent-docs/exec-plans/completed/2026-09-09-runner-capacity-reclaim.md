# Reclaim container capacity from duplicated deployment banks

## Outcome and invariant

Recover roughly 700 member slots within the existing account allocation by removing the full-size inactive deployment reservation. Preserve member isolation, checkpoint ownership, accepted-work recovery, exact image readiness, and consumer-first compatibility.

## Evidence and owner

The generated deployment config gives RunnerContainer and NextRunnerContainer the same member ceiling. The deployment helper alternates banks and requires full inactive admission before promotion. Retiring the legacy application does not remove that second reservation. Current official Cloudflare rollout documentation describes stop, drain, and replacement within an application; it does not require a duplicate member application.

## Work

1. Consult ReviewGPT against the guarded current source snapshot and independently check provider semantics.
2. Trace release identity, native application ownership, warm bindings, and deployment recovery. Select the smallest safe migration at these existing owners.
3. Implement the correction, remove superseded duplication, and update the durable deployment contract.
4. Reproduce both bank directions, warm active work, cold starts and standby allocation, partial failure, retries, subsequent releases, and capacity accounting.
5. Run focused tests, typecheck, parent review, complexity checks, and required final ReviewGPT and CI gates.
6. Prepare a concrete protected production transition with live capacity verification; distinguish implemented code from deployed capacity.

## Product UX and proof

Affected journeys: an active conversation during rollout; a new or cold member during rollout; checkpoint publication at shutdown; release failure followed by retry; and the next routine release. Preserve bounded recovery without silent work loss. No assistant prompt or provider-input change is intended. Local product readiness covers synthetic runtime and deployment boundaries; production readiness remains Hold until the protected migration proves live quota, distribution, checkpoint recovery, and smoke.

## Decisions and progress

- Work is isolated on a fresh branch from current public main. Existing deployment plans remain owned by their original tasks.
- ReviewGPT architecture consultation completed on the guarded base snapshot with verified Pro metadata. It confirmed duplicated ceilings and recommended a permanent serving application, one-time drained retirement, native replacement, exact image-pair admission, paused pristine preparation, and recoverable pending rollout state.
- Baseline: 137 focused release, provider, deployment CLI, and container-entrypoint tests pass. Cloudflare typecheck passes after installing the complete frozen workspace dependency graph.
- A synthetic regression covering both bank directions fails before correction: requesting a 748-member ceiling retains a 324-instance old bank, producing 1,073 total declared slots including smoke instead of 749.
- Provider contract: [native rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/) stop and drain each selected container before replacement. The published [account defaults](https://developers.cloudflare.com/containers/platform/limits/) are not measured account-specific quota. At the configured shape, 748 member slots plus one smoke slot require 1,498 vCPUs; other account applications must be included in production admission.

- The implementation retains the active allocation ID across image releases. This preserves existing exact binding-origin admission across successive deployments without widening historical origin acceptance or adding an origin registry. Previous-bank descriptors remain for safe retained cleanup.
- The original 1,073-slot regression now passes at 749 total slots in both bank directions. Focused proof covers pending-image reuse, drift rejection, native lost-response reconciliation, distribution completion, preserved Worker-only pending authority, and all-application quota accounting.
- No assistant prompt, tool selection, response content, individual/group provider input, database query, or foreground network operation is added. Existing process health admission recognizes a bounded pair during transition; ownership, checkpoint, and generation checks retain their owners.
- Changelog is not applicable: this changes internal deployment reservation and recovery. No production ceiling or member-facing capacity claim is shipped by the source PR alone.
- Production transition remains separate: use the protected Murph Cloud workflow with compatible-reader-first order, reconcile any old cross-bank pending release, and only then set the selected member ceiling after measured quota admission. A 748 application ceiling leaves approximately 746 member-bound slots when two pristine standbys are maintained; 702 is the more conservative 700-bound-slot option.

- Parent review: checked native mutation order, one-fleet totals in both directions, immutable retry target, exact pair admission, previous-bank cleanup, standby pause, generation invalidation, privacy, and the unchanged protocol-floor checks. No new state store, custom instance scheduler, or request retry loop is introduced.
- Verification: Cloudflare typecheck passed; 103 current release/provider/image/CLI tests passed; 134 renderer/config/receipt/image/CLI tests passed before the final provider-only refinements; 186 runtime/standby/shutdown/provider/CLI tests passed. Existing runner-container, callback, and identity coverage passed 308 cases, followed by the two added native-replacement cases passing after correcting their boundary double. Complexity ratchet passed; five preexisting runner-container hotspots are unchanged and are not expanded by the health comparison. Final CI and final ReviewGPT remain pending.

## Source completion and deployment handoff

- Final ReviewGPT: PASS at `ac533fec6b658e9af7f5b3ce65437bbc19d6ee09`, with verified `gpt-6-pro` response metadata and hash. The reviewer checked all 77 new-side source hunks and passed 18 deterministic helper scenarios. No accepted findings remain.
- Parent final review agrees with the result. The production implementation is unchanged after that review; the final correction is isolated to an unrelated audio abort-replay fixture whose fixed date crossed content retention. Its three tests and assistant-runtime typecheck pass. The associated Frog entry is included with the final scoped commit.
- Post-review edits qualify as isolated test/proof and explanatory documentation; they do not change deployment behavior, runtime configuration, schema, or the implemented contract. No further substantive ReviewGPT round is needed under the review-loop exemption.
- PR: https://github.com/cobuildwithus/murph/pull/3109. Required CI on the final authored head remains a release gate. The first reviewed head passed Cloudflare verification, build/typecheck, and runner-bundle checks. Its unrelated audio fixture failure is corrected; a separate browser-install mirror checksum failure is external infrastructure evidence, not a passing viewport result.
- Protected production order after source approval: merge the verified source, set the desired production `CF_CONTAINER_MAX_INSTANCES` ceiling (748 for maximum recovery at the current shape, with quota admission required), and run `deploy-cloudflare-hosted.yml` from private main with production environment, immediate image rollout, predeploy gates enabled, and normal smoke. The workflow resolves one public-main source SHA. Do not disable integrity checks or protocol floors.
- Confirm the unused member bank is drained and reduced to zero before serving expansion; retain the already-retired legacy application's zero ceiling. Verify actual account resources, final Worker/image receipt, restored standby inventory, signed smoke, and checkpoint/runtime error aggregates. No production ceiling, deployment, or rollback was changed in this task.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
