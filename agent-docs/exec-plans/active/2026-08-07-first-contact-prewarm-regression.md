# Recover first-contact container overlap without selecting an owner

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Recover the roughly 0.7-second normal-path cold-start regression introduced
  by PR #1345 without restoring the earlier activation-before-conversation
  ownership race or weakening access, mailbox, fence, or reply durability.

## Success criteria

- The instant-start path issues only a deterministic container start command
  before enrollment; it does not resolve a `UserRunner`, read workspace or
  access state, select a mailbox owner, create a fence, wait for readiness, or
  invoke work.
- The instant-start path does not call direct ensure-processing after enrollment
  while the activation mailbox item exists and the original conversation does
  not.
- The ordinary committed conversation signal remains the first runtime wake and
  the deferred activation continuation remains ordered after that handoff.
- Enrollment failure, provider redelivery, signup fallback, typing feedback,
  active-member wakes, and Assistant Ask direct wakes remain unchanged.
- Focused Web tests and typecheck pass, and the hosted-local foreground scenario
  still proves one owner, one conversation, one provider request, and one reply.
- A controlled baseline/candidate comparison shows a positive normal-path
  provider-start result before any saving is counted.
- Preliminary specialist ReviewGPT, final ReviewGPT, exact-head CI, and parent
  final review pass before merge.

## Scope

- In scope:
  - Replace the post-enrollment direct ensure with an owner-neutral,
    command-only shell start before enrollment.
  - Add the narrow OIDC Web-to-Cloudflare control contract and deterministic
    container RPC needed to issue that command.
  - Remove the now-unused instant-start direct-wake source and stale contract
    language.
  - Adjust focused tests and benchmark selection only as needed for truthful
    ordering and latency proof.
- Out of scope:
  - Changing trial enrollment, Stripe, Temporal, activation persistence,
    mailbox schemas, runtime fences, runtime processing, or deploy settings.
  - Reintroducing the rejected readiness prewarm, which resolved the ordinary
    runtime path and waited for readiness instead of issuing only `start()`.
  - Deploying Web or Cloudflare.

## Root-cause evidence

- PR #1345 correctly deferred the activation signal until after the ordinary
  conversation handoff, but moved container prewarming from before enrollment
  to after enrollment. A hosted-local 30-vs-30 comparison measured a roughly
  663–737 ms regression on the normal path, matching the overlap that was lost.
- Deleting the post-enrollment direct ensure was tested first. The exact valid
  balanced 10-vs-10 prefix measured provider p50 6.783 s with #1345's ensure
  versus 7.163 s without it, and delivery p50 7.259 s versus 7.720 s. Deletion
  is therefore rejected; it delays useful startup by another 380–461 ms.
- The earlier owner-neutral readiness prewarm is also rejected: it ran the full
  readiness path and measured slightly slower in a balanced 10-vs-10 A/B.
- The first corrected command-only 10-vs-10 attempt stopped at sample four
  because the benchmark detected a recovered runtime generation while the
  shared host was under extreme unrelated test load. No partial timing from
  that run is countable. Two further shared-host attempts were also invalidated
  by recovered generations and contribute no performance evidence.
- An isolated Blacksmith comparison on exact experimental head `44eacea7cd9d`
  completed three warmups and twelve measured cold starts with six samples per
  variant. Every sample proved one successful cold attempt, mailbox consumption,
  provider start, and reply delivery. Post-enrollment ensure measured provider
  p50 1.834 s and delivery p50 2.038 s; command-only shell measured provider p50
  1.141 s and delivery p50 1.376 s, improving those medians by 693 ms and 662 ms.
  Candidate provider samples ranged from 904-1,295 ms versus baseline
  1,613-1,949 ms, so the distributions did not overlap.
- The remaining minimal hypothesis is narrower. Cloudflare Containers exposes
  a command-only `start()` that does not wait for ports. Issuing that command
  against the deterministic container before enrollment can overlap platform
  startup without touching the authority path; the ordinary post-Temporal
  direct ensure still owns readiness, workspace state, fencing, and processing.

## Risks and mitigations

1. Risk: the shell hint accidentally gains runtime authority.
   Mitigation: route directly to the deterministic container and expose a
   dedicated RPC that calls only `start()` after validating stopped state; unit
   tests prove no `UserRunner`, readiness wait, workspace call, fence, or invoke.
2. Risk: enrollment fails after starting a shell.
   Mitigation: the shell has no work or owner and expires through the existing
   idle lifecycle; enrollment failure keeps its current signup fallback.
3. Risk: the activation item becomes stranded.
   Mitigation: preserve the deferred continuation and exact-event redelivery
   tests; the conversation signal reconciles both lanes before the continuation.
4. Risk: ordinary direct-wake behavior changes accidentally.
   Mitigation: remove only the instant-start source and retain all post-Temporal
   direct ensures for active Linq and Assistant Ask paths.
5. Risk: command-only startup still does not improve latency.
   Mitigation: run a balanced no-hint/command-hint comparison with the measured
   enrollment lead and close the candidate unless provider-start improves.

## Tasks

1. Inspect the current main call path, focused tests, benchmark harness, and
   active-owner timing evidence.
2. Reject deletion and readiness-prewarm candidates from controlled evidence.
3. Implement the command-only control route, container RPC, Web hint, focused
   tests, and live protocol docs.
4. Run focused package, Cloudflare, and Web tests/typechecks plus the
   hosted-local foreground proof.
5. Run a controlled baseline/candidate cold-start comparison and record the
   exact distributions and correctness gates.
6. Commit and push the candidate, open the PR, start preliminary and final
   ReviewGPT concurrently with CI, resolve findings, and rerun affected proof.
7. Complete parent review, close this plan through `scripts/finish-task`, merge
   the exact green head, and retire the clean worktree.

## Verification

- Focused shared-control, RunnerContainer, Worker-route, and Web Vitest files
  covering the command-only boundary, authorization, direct wake,
  instant-start dispatch, enrollment continuation, and crash/redelivery.
- Shared-control, Cloudflare, and Web typechecks plus `git diff --check`.
- Hosted-local post-enrollment foreground proof with the private Temporal worker.
- Balanced hosted-local cold-start baseline/candidate comparison with coldness,
  one-owner, mailbox, provider, and delivery assertions. Completed on isolated
  Blacksmith with a 693 ms provider-start p50 improvement and 662 ms delivery
  p50 improvement across six measured samples per variant.
- Preliminary `completion-specialists`, final ReviewGPT, and required exact-head
  GitHub Actions.
