# Hosted Device-Sync Job Timing Telemetry

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Increase the bounded hosted device-sync pass opportunity from 90 to 120 seconds.
- Record privacy-safe per-job timing and disposition metadata so operators can
  identify which provider, job kind, and bounded resource class consume a pass.
- Preserve foreground preemption, durable continuation, mailbox ordering, and
  the existing 45-second cap for atomic dense-raw cleanup.

## Constraints

- Log metadata only: no member or account identifiers, job identifiers,
  payloads, cursor values, provider responses, health values, or raw errors.
- Reuse the existing ordered runtime-log buffer and strict Web parser; add no
  queue, scheduler, persisted state, or retry owner.
- Keep telemetry best-effort and outside the provider-work critical path.
- Deploy the tolerant Web log parser before fully recycling the Cloudflare
  runner that emits the expanded event.

## Product UX

- This is a reliability patch for members with connected health data; it adds
  no new screen or interaction.
- Foreground conversations remain preemptive. The longer background pass only
  applies while no higher-priority work asks the cooperative worker to yield.
- A changelog entry explains the extra catch-up time without promising that all
  provider jobs now complete inside one pass.

## Plan

1. Trace the current device-job execution and runtime-log ownership boundaries.
2. Add a bounded per-job lifecycle record with provider, job kind, resource
   class, elapsed time, disposition, attempt metadata, and durable-progress
   presence only.
3. Raise both hosted device-maintenance entry paths to 120 seconds while keeping
   dense-raw cleanup capped at 45 seconds.
4. Add focused parser, runtime, service, and entrypoint regression coverage and
   update the durable runtime/deploy contracts.
5. Run focused tests and typechecks, commit and push an exact PR candidate, then
   run required specialist, ReviewGPT, CI, and parent-review gates.
6. Deploy Web before the Cloudflare runner, fully recycle existing containers,
   and verify live timing records plus mailbox-frontier convergence.

## Verification

- Focused package tests: device-sync service 141 passed; hosted-execution parser
  33 passed; assistant-runtime lifecycle/entrypoint coverage 413 passed.
- Focused typechecks passed for `device-syncd`, `hosted-execution`, and
  `assistant-runtime`.
- Log privacy guard, docs drift guard, and `git diff --check` passed.
- Diff-aware package verification passed every affected package typecheck and
  package suite, including 4,097 assistant-engine, 2,490 assistant-runtime,
  1,192 CLI, 1,266 device-sync, and 557 hosted-execution tests.
- The broad Web run passed 11,087 tests and found one outcome-copy violation in
  the new changelog entry. The entry was corrected; the exact changelog policy,
  fragment, and page rerun passed all 54 tests.
- Cloudflare app verification passed its typecheck, 2,668 Node tests, and 15
  Workers-runtime tests.
- PR ReviewGPT, exact-head CI, merge, ordered production deployment, and live
  runtime verification remain pending.
