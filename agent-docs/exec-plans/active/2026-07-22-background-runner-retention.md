# Reduce background-only runner warm retention

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Stop paying the full conversational warm-container tail for hosted runtime
  activity that exists only to perform device sync or other internal
  maintenance.
- Preserve the warm follow-up experience for real user conversations and every
  existing foreground, checkpoint, ownership, and recovery invariant.

## Success criteria

- ReviewGPT independently reviews the current architecture from a neutral
  problem-and-goal prompt before implementation decisions are made.
- Background-only hosted work no longer creates an unnecessary 20-minute warm
  shell under the accepted architecture.
- User conversation work retains the existing warm follow-up behavior,
  including when it arrives during a maintenance-triggered invocation.
- The solution adds no second scheduler, queue, runtime owner, container class,
  or speculative persisted product state.
- Focused coverage, canonical verification, direct lifecycle proof, CI, and the
  required ReviewGPT gates pass on the exact PR head.

## Scope

- Private assistant-runtime observation and container response/health metadata
  needed to communicate the independently selected retention decision without
  changing public invocation requests or results.
- Cloudflare runner readiness/invocation lifecycle ownership and focused tests.
- Assistant-runtime foreground/background observation and focused tests.
- Current durable runtime/container documentation when the implemented
  lifecycle contract changes.

## Constraints

- ReviewGPT receives only the observed cost problem, required user behavior,
  and the stated simplicity priority; do not seed it with a proposed design.
- Do not classify solely from the wake trigger when actual work can change
  during an invocation.
- Do not shorten the runtime-owned 180-second quiet/checkpoint floor or destroy
  a shell before successful durable completion.
- Missing or old-version lifecycle metadata must fail safely during rolling
  Worker/container deployment.
- Preserve unrelated worktree and ledger changes. Coordinate narrowly with the
  existing runner destroy-timeout lane and avoid reorganizing its owned stop
  and readiness internals.

## Tasks

1. Obtain and record an unbiased ReviewGPT recommendation from a clean task
   worktree with repository context attached.
2. Verify the recommendation against the complete runtime, readiness,
   checkpoint, wake, and rolling-deploy paths.
3. Implement the smallest correct owner-boundary change with focused regression
   coverage.
4. Run canonical verification and direct lifecycle proof.
5. Open the PR and complete preliminary specialist review, parent final review,
   final ReviewGPT, CI, and mergeability proof.

## ReviewGPT architecture decision

- Keep the existing idle TTL as a semantic conversation warm lease, mint it
  only from fresh staged or provider-admitted conversation input, and start it
  when the invocation settles.
- Add a separately configurable short lifecycle reevaluation cadence. When the
  new variable is absent, fall back to the existing TTL so the additive code
  deploy has no behavioral effect.
- Carry only a private process watermark through the runner response header and
  health endpoint. Persist one bounded warm-until scalar in RunnerContainer
  Durable Object storage; do not add public execution fields, schedulers,
  queues, wake-source taxonomies, or Temporal/UserRunner state.
- Fail closed on storage, health, or lifecycle uncertainty and close the
  wake-versus-destroy race with an interaction generation checked immediately
  before destruction.
- Roll out by leaving the new cadence unset for one legacy-TTL observation
  window, draining old containers, and then canarying `60000` before widening.

## Evidence

- Checked-in production defaults currently set the runner idle TTL to 20
  minutes while assistant-runtime owns a separate 180-second quiet/checkpoint
  floor.
- `RunnerContainer` renews the shared activity timer for runtime wake and all
  invocation stages, so maintenance and device-sync activity receive the same
  warm tail as conversation work.
- Git history records that the 20-minute TTL was introduced to improve
  back-to-back user-message latency.
- Product-experience review returned no findings: the implementation preserves
  the existing follow-up journey and introduces no user-facing lifecycle
  concept or control.
- Focused in-process coverage proves fresh, recovered, replayed, maintenance,
  uncertainty, compatibility, persistence, expiry, and wake-versus-destroy
  paths, including the real container entrypoint HTTP boundary.
- Canonical `pnpm test:diff` passed through the configured Blacksmith Testbox:
  1,794 assistant-runtime tests passed with 2 skipped, and 1,867 Cloudflare
  tests passed.
- Managed Cloudflare timing remains a rollout proof: canary maintenance-only
  shutdown near 60 seconds, conversational warmth for 20 minutes, fast
  follow-up reuse, and Durable Object reconstruction without lease loss.
