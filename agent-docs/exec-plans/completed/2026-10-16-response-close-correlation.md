# Correlate runner transport closures with their request and attempt

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal

Distinguish which bounded request kind lost its HTTP transport and, when parsed,
which workspace attempt owns it. Reuse the existing request-exit warning;
telemetry is not evidence that accepted invocation work stopped.

## Evidence and scope

Source emits request-aborted/response-closed warnings with exitReason only.
Its controller covers health, wake, smoke, abort and invocation requests.
Accepted workspace work uses a separate invocationAbort owner. Platform region
metadata does not supply the missing request or attempt correlation. Synthetic
proof will expose this missing observation without production content.

Only add privacy-safe diagnostic fields and focused tests plus owner guidance.
No execution, abort, lifetime, retry, timeout, request validation, persisted-state,
severity, message or logging-volume change. No raw URL, header, body, member ID,
error text or provider value. Use the existing attempt correlation convention.

## Ownership and verification

This isolated branch starts at public main after the catalog isolation merge.
The current typing-transport change affects a separate diagnostic owner; open
idle-cleanup PR 3994 does not touch this request-exit controller. Do not mutate
another owner's worktree or deployment. Preserve the catalog rollout owner.

1. ReviewGPT authors the smallest metadata-only correction and synthetic proof.
2. Parent reproduces missing fields on baseline, then inspects privacy, runtime
   cost, bounded types and actual accepted-invocation lifetime behavior.
3. Run focused entrypoint tests, Cloudflare typecheck, complexity and docs checks.
4. Push Draft, complete parent proof, mark Ready, final ReviewGPT concurrently
   with exact-head required CI; resolve findings under the review-loop contract.
5. Merge only with green gates. Use canonical release with runner-image handling;
   Worker-only deployment cannot publish container entrypoint changes. Preserve
   other active rollout owners. Verify serving revision and natural diagnostic
   if exercised; otherwise save the exact bounded read-only follow-up query.

## Decisions

Additional metadata on the existing warning can close the correlation gap.
No new warning, monitoring system, product state or speculative recovery.
The native platform connection-closure cause remains unresolved.

## Verification

ReviewGPT authored the source, direct socket regressions and owner guidance.
Parent applied the new abort tests to original source: three missing-correlation
failures and four passes. Patched entrypoint and abort suites pass all 88 tests.
Cloudflare typecheck, docs drift and gardening pass. Complexity remains debt 71,
maximum 84; parent removed an unnecessary internal null-to-false conversion so
only the log serializer boundary supplies the explicit false absence value.
Existing hotspot dispatch and wake ownership are unchanged; extracting unrelated
routing would broaden this observation-only change.

Parent verified all route status codes, malformed/partial input, concurrent wake
isolation, accepted invocation completion despite socket closure, later explicit
abort and slot reuse, first-event-only logging, listener cleanup, and actual
structured serialization. No external calls or awaits are added. All fixture
content is synthetic. Provider delivery and semantic reply recovery remain
separate facts. Final ReviewGPT passed on `14b1ee9808411c4397182d7cc2a15106ab8ccc51` with zero
findings. Exact response hash, accepted-turn identity, GPT-6 Pro model and
minimum response interval were verified. This closing commit changes only the
explanatory plan; production and tests remain byte-identical. Exact final-head
CI, merge and canonical deployment remain external completion gates tracked in
the PR and automation memory, not claimed completed here.

Review: https://chatgpt.com/c/6ad26cca-2388-83e9-b62c-495d53628240
Completed: 2026-10-16
