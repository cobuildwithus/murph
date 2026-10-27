# Attribute intentional reply pacing in latency alerts

Status: completed
Created: 2026-10-27
Updated: 2026-10-27

## Outcome and invariant

Outcome: Preserve the documented reply-bubble cadence while distinguishing configured pauses from unexpected final-reply delivery latency.
Reaches: Hosted Linq foreground reply dispatch, the existing latency monitor, and its operator email.
Proof: Synthetic sequential sends retain 1.5-second pauses; only uniquely attributed same-attempt pauses adjust the strict alert budget. Raw timing and real failures remain visible.

## Evidence and ownership

The delivery drain deliberately waits after confirmed same-reply siblings. The monitor previously applied a fixed budget to the final bubble without observing those waits. Bounded metadata-only diagnostics corroborated sequential dispatch and configured spacing. No private production evidence is retained here.

The existing drain owns a transient configured-wait accumulator, reset between unrelated sequences. Its existing dispatch observation carries one optional numeric field. The monitor owns validation and budget comparison; no canonical state, queue, retry, provider call, or delivery authority changes.

## Scope and compatibility

- Retain cadence, order, cancellation, recovery, and raw elapsed measurements.
- Exclude configured waits only; timer overshoot remains chargeable.
- Missing, malformed, ambiguous, cross-attempt, or chronologically impossible attribution receives no exclusion.
- Existing readers ignore the optional field. New readers retain old behavior for older producers. Web can ship before runtime; neither order changes delivery safety. No migration or rollback floor.
- Changelog not applicable: internal alert interpretation only; member delivery behavior stays unchanged.
- No live-model journey required: prompts, tools, reply content, and model decisions are unchanged.

## Tasks

1. Record configured completed pacing in dispatch observations.
2. Validate exact attribution and compare both independent origins against the existing budget after pacing.
3. Render the exclusion explicitly while preserving full timings.
4. Run focused regression suites, relevant typechecks, diff/complexity review, and scoped completion.

## Verification

- Passed: `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts --no-coverage` (318 tests).
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-runtime-final-reply-delivery-alert.test.ts apps/web/test/hosted-onboarding-linq-alert-email.test.ts --no-coverage` (57 tests).
- Passed: `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir apps/web typecheck`.
- Web tests initially required the fresh checkout's generated Prisma client; the normal `prisma:generate` prerequisite resolved it.
- Passed: `pnpm complexity:diff` and `git diff --check`. The delivery drain's existing complexity dropped from 37 to 36 by removing redundant null conversions accepted by its existing resolver. Other listed hotspots were unchanged; a broader refactor is unnecessary for this diagnostic correction.
- Parent review: synthetic pacing, unrelated-sequence reset, unchanged abort/failure behavior, optional-field parser compatibility, both timing origins, strict threshold edges, older producers, malformed attribution, and handoffs covered. No new awaited work or network/database call.
- Product UX: Ready for the scoped alert correction; member-facing cadence and order unchanged.
- Local implementation only. PR review, exact-head CI, and production rollout are not part of this local proof; production still requires the new runtime observation and Web reader before the revised classification is effective.
- Historical provider request failures remain distinguishable from configured pauses; this patch does not claim to resolve an upstream rejection or eliminate real delivery latency.
Completed: 2026-10-27
