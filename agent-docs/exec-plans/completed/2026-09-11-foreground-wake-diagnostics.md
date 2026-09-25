# Foreground wake diagnostics and root-cause follow-up

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and scope

Preserve the committed foreground-wake simplifications while making failed and slow wake attempts explainable through existing metadata-only observability. Investigate the unresolved pre-notification delay with ReviewGPT and production-safe local reproductions. Do not infer that an accepted wake or an asynchronous canonical lock wait proves a transport cause.

## Owners and approach

Use the existing Web admission, Temporal recovery, UserRunner fence, container transport, entrypoint notification, and isolated runtime-log owners. Trace dispatch, receipt, acknowledgement, command budget, liveness, and retry attribution. Prefer bounded summaries on existing logging paths; no new scheduler, service, database, or durable state.

1. Confirm task checkout/head and inspect current contracts, actual installed Containers SDK, and read-only incident evidence.
2. Ask ReviewGPT for a fresh, thorough root-cause investigation and a scoped diagnostic patch, with exact relevant dependency context.
3. Reproduce candidate causes and independently review the returned patch. Add only diagnostic fields that answer an observed evidence gap and preserve wake timing, authority, and failure behavior.
4. Verify real composed boundaries, privacy/failure isolation, typechecks, complexity, documentation, and a scoped commit.

## Product and release

Internal observability is the primary outcome. Any additional behavior correction needs a failing reproduction and updated product evidence. Keep all previously verified foreground, blocked-authority, atomic-write, and recovery paths. No production mutation or deployment is authorized. New telemetry must be consumable by the existing deployed log parser or have a documented consumer-first rollout.

## Evidence and limits

The prior commit is the starting candidate. The earlier consultation found real avoidable retries and cleanup preemption gaps but did not attribute the original first-notification delay. Private production rows, exact member identifiers, timestamps, and feedback stay out of review packets and committed artifacts. Use synthetic fixtures and coarse aggregate findings.

## Progress

- Resumed the original task-owned branch at its expected clean committed head.
- Reusing existing Frog reports for any previously documented ReviewGPT tooling issues.
- Read-only workflow history confirms two approximately nine-second ensure calls and an intervening ten-second retry timer. The continuation boundary itself was brief. The stored activity results omit the retry reason, so they do not distinguish consent-lock queueing from a container RPC timeout.
- The direct ensure acquired consent authority promptly and returned `retry_later` after roughly six seconds. Runtime notification occurred much later. This narrows the original gap to work after lock admission and requires distinguishing caller completion from eventual runtime receipt; it does not establish why transport or request processing stalled.
- The installed Containers SDK can run implicit readiness before a wake and can convert native fetch exceptions into HTTP 500 responses. Dedicated tests exercise the actual pinned dependency. A separate real RunnerContainer regression proves that an already-expired wake signal survives that HTTP conversion through response draining; the SDK conversion alone is not a demonstrated application bug.
- A fresh ReviewGPT investigation is running against the committed simplification, current owner code, exact dependency implementation, and sanitized incident timing. Requested metadata-only diagnostics must cover failures before container receipt and remain outside authoritative wake work.

- Recovered the completed GPT-6 Pro follow-up and verified the exact assistant response before downloading its supplemental patch. Reused the known attachment/capture tooling friction reports. Independently reconciled the supplement with the local privacy and owner-convergence regressions.
- Added one metadata-only `runner.processing_finished` summary through the existing signed runtime-log callback. It records admission, caller RPC dispatch/outcome, returned container transport/handler timings, liveness, retry attribution and final result. Fingerprinting and the callback are detached; neither hashing, rejection, cancellation nor scheduling failures can change processing control.
- Removed the diagnostic opt-in flag and optional internal-observation branches. Kept diagnostic fields outside the incoming RPC contract, discarded superseded fence observations, and preserved late runtime work after caller timeout. Extracted only the bounded header parser and summary builder into their existing owners to keep control flow readable.
- The authoritative ensure-processing response, retries, deadlines, state ownership and wake acceptance behavior are unchanged by this follow-up. The earlier foreground-wake simplification remains in the parent commit.

## Verification and disposition

- Cloudflare controller, container, entrypoint and fleet suites: 565 tests passed across the final affected runs. This includes caller-timeout versus returned-timeout attribution, late replies, consent denial/queueing, same-attempt generation changes, concurrent correlation, old replies without metadata, hash failures, and log-response cancellation/rejection.
- Actual installed Containers helper suite: 10 passed. Web internal runtime routes: 91 passed, including real log parsing and proof that a failed processing summary cannot trigger accepted-attempt recovery. Total focused coverage: 666 tests.
- Cloudflare, hosted-execution and Web typechecks passed; Cloudflare was rerun after final refactoring. Complexity and raw-payload logging guards passed. Documentation drift and whitespace checks passed.
- Parent review: no new authoritative state, queue, retry, dependency or provider-input work. Existing high-complexity lifecycle functions remain; the branch reduces the controller hotspot from 24 to 20 and the container wake hotspot from 74 to 73. No further lifecycle refactor is justified by this diagnostic task.
- Product UX: Ready for internal observability. This follow-up changes no assistant prompt, model input, tool choice, reply text or public control response, so an additional real-Codex journey and public changelog entry are not applicable. All added network work is one bounded best-effort log callback per completed command, outside the awaited foreground path.
- ReviewGPT confirmed diagnostic corrections, not the original transport cause. Its local harness limits are supplemented by the repository suites above. Neither its deadline-gap reproductions nor installed-SDK readiness behavior establishes the cause of the original incident.

## Release and remaining investigation

Local completion only: no push, PR, merge or deployment was requested for this follow-up. Deploy the additive Web event-code consumer before the Worker producer. Older containers may omit optional timing metadata; old Web rejects the new event without affecting the processing result. No migration is required. After rollout, inspect bounded processing-summary aggregates and correlate fingerprints plus attempt/generation and command time with runtime notification milestones and workflow history.

The original stall remains unattributed. The retry timer explains part of the elapsed delay, but not why the first wake failed to notify promptly. Caller-timeout rows cannot contain a child response that arrived later, and the dispatch-to-response interval includes SDK readiness/lifecycle and native transport. Further attribution requires independently correlated SDK/container and runtime-receipt evidence; do not claim that this patch eliminates all reply delays.
Completed: 2026-09-11
