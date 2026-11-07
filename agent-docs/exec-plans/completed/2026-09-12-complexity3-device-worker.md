# Pro implementation of device worker admission simplification

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Reduce the complexity of the existing device-worker pass through a Pro-authored patch, preserving accepted-work durability, lease and account authority, bounded execution, and observable success/failure behavior.

## Scope and owner

The existing controller in `packages/device-syncd/src/service.ts` remains the worker owner. Pro may modify that source and necessary focused regressions in `packages/device-syncd/test/service.test.ts`. No schema, dependency, exported API, provider policy, store implementation, or runtime framework changes.

## Evidence and design direction

At base `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`, the identified seam has file debt 87 and maximum complexity 81 in `runWorkerPassOnce`. The pass repeatedly combines account status with accepted companion/calendar retention policy before execution and again during failure disposition. Pro simplified those decisions with one narrow private admission boundary and shared retained-work derivation, preserving the existing side-effect order.

## Protected invariants

Preserve no-claim yield/budget checks; missing-provider/account precedence; invalid-calendar rejection before account status; the ordinary/companion/calendar admission matrix; conditional ownership transitions and reconnect fences; per-account and bounded provider batching; exact lease expiry; token persistence before cooperative yield; canonical receipt identity and caps; atomic completion plus follow-up enqueue; per-row retry budgets and timeseries progress; failure diagnostics and timer cleanup. No authority may be cached across an await.

## Tasks

1. Prepare a private implementation packet with source/test navigation, exact traps, allowed paths, and required patch attachment/model confirmation.
2. Parent sends the packet to Pro and retrieves the completed patch. Local source and tests remain untouched until that handoff.
3. Parent audits/applies the patch, runs focused proof, checks privacy and complexity, and owns PR/review/completion. Close this plan through the ordinary final-task wrapper when implementation is complete.

## Verification

Run the existing service suite with one worker, device-sync package typecheck, scenario-manifest integrity, and complexity diff against the task base. Add only regression cases needed to prove changed decision boundaries through the public service and real fixture store. Broad exact-head CI remains parent-owned.

## Completion evidence

The exact Pro-authored implementation and incremental test-proof patches are applied. The parent verified actual Pro model/capture identity; local application verified both SHA-256 hashes and patch-result source/test identities. No local source/test redesign was introduced. Frozen dependency installation and Frog listing pass; no new friction entry or workaround was needed.

- Native full service suite: 169 passed. The proof correction compares the same hydrated account read before and after execution; all authority, retry, diagnostic, and side-effect assertions remain.
- Device-sync package typecheck passes with one checker and one builder after the correction.
- Scenario integrity passes: 205 scenarios, 12 sample inputs, 29 golden-output directories. The incremental test-only correction leaves that evidence valid.
- Actual complexity guard passes: debt 87 to 76, maximum 81 to 70; the admission helper is 9. The unchanged error-diagnostic helper remains 46.
- Diff whitespace and privacy inspection pass. The PR records both Pro patch hashes, exact verification commands, and remaining hotspot disposition.

Implementation and local proof are complete. Parent owns final candidate review, Ready admission, ReviewGPT, exact-head CI, and any later merge decision.
Completed: 2026-09-12
