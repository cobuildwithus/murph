# Observe Responses relay queue pressure at existing milestones

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

- Distinguish accepted relay queue pressure from other Worker memory pressure at existing Responses WebSocket diagnostic milestones. Frame counts alone cannot establish retained queue bytes.

## Success criteria

- Observe current and peak accepted bytes/messages, using the existing reservation owner and fixed limits. Preserve forwarding, accounting, admission, close ordering, and diagnostic event count.
- Focused composed tests prove blocked and drained queues, UTF-8/binary sizing, overflow, and throwing sinks. Required final review and exact-head CI pass.

## Scope

- In scope: one telemetry-only relay observation, focused tests, existing owner documentation.
- Out of scope: memory recovery, queue policy, provider contracts, retries, new log events or timers, member data and production configuration.

## Constraints

- Technical constraints: scalar metadata only; no payload retention, new correlation, network call, or persistence owner. Missing observations remain unknown.
- Product/process constraints: ReviewGPT implements substantive telemetry. Parent validates behavior and privacy. Telemetry-only merge and canonical deployment require all normal gates.

## Risks and mitigations

1. An observation could be mistaken for total isolate memory or process-terminal evidence.
   Mitigation: document accepted pending frame bytes and connection-local high-water semantics; preserve sampling and missing-tail limitations.
2. Logging could change hot-path behavior or cost.
   Mitigation: reuse counters and existing bounded sink; no extra event emission or awaited work; throwing sink proof.

## Tasks

1. Confirm existing diagnostics and actual competing PR scope; completed, no same-question owner found.
2. Obtain and critically inspect the ReviewGPT implementation.
3. Run focused proof, typecheck, privacy, complexity and documentation checks.
4. Open scoped PR, run final ReviewGPT concurrently with required CI, and disposition findings.
5. If telemetry-only gates pass, merge and use canonical deployment; verify revision and natural telemetry through read-only queries.

## Decisions

- Existing queue reservations are the sole source of current occupancy. High-water observations are bounded scalars and never participate in admission.
- Internal operational change; no product journey, prompt, or initial provider-input change.

## Verification

- Commands to run: focused Cloudflare WebSocket tests, Cloudflare typecheck, relevant runtime-log compatibility proof, documentation/privacy/complexity guards.
- Expected outcomes: distinguish blocked backlog from drained traffic with identical socket effects and event sequence; old consumers accept additive scalar diagnostics.

## Candidate evidence

- ReviewGPT implemented the six scalar observations, two peak scalars and focused tests; the parent retained the patch without production changes beyond that proposal.
- The new mixed-backlog regression fails on the original relay solely because queue observations are absent. With the implementation, all 38 WebSocket tests pass.
- The real runtime-log parser accepts full milestone records with the six additive fields and reporter metadata, and still accepts older records without them.
- Cloudflare typecheck passes after ordinary local Prisma client generation. Admission, releases, forwarding, accounting, close ordering, event sequences and the existing bounded reporter are unchanged.
- Privacy review: only numeric sizes/counts, no frame data, new correlation, event, request or persistence owner. No new awaited foreground work. Two scalar maxima update per admitted frame; six fields append only to existing diagnostic emissions.
- Complexity guard passes against the immutable task base; both source files have zero complexity debt and no functions above 20.
- Final ReviewGPT, exact-head CI and authorized telemetry-only deployment remain completion gates.

## Final review and handoff

Final ReviewGPT passed on `a7d0decc6368ca92db86c305b8f1a20ca5c5c6b6`
with no qualifying findings. The exact submitted turn, response digest and
GPT-6 Pro response metadata match; observed response wait was 610.3 seconds.
The full six-file snapshot includes both relay owners, focused tests and the
unchanged runtime-log parser. The parent accepted the review and reconfirmed
that production source and tests match the reviewed candidate.

Implementation and review are complete. PR #3533 retains required exact-head
CI and the telemetry-only merge/release gates; this plan closure is not a CI or
production success claim. A bounded natural-traffic read already finds existing
milestones without the new fields, establishing the predeployment baseline.
After the guarded Worker-only release, verify the serving revision and field
presence; absent traffic or missing tails remain evidence gaps. No member work
is replayed and no messages or operational configuration are changed.
Completed: 2026-09-17
