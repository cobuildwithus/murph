# Preserve installed iOS workout protocols during backend rollout

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Merge the backend workout fixes without requiring installed iOS clients to update.

## Success criteria

- Legacy clients receive only their existing URL-result protocol and active V6/completed V4 message cards.
- Explicitly opted-in clients retain direct V6 results, including completed and oversized editors.
- Auth, canonical state, durable outcomes, and replay identity remain unchanged.
- Focused mixed-version tests, typechecks, exact-head CI, and ReviewGPT pass before merge.

## Scope

- In scope: public iMessage result projection, native card transport compatibility, mixed-version proof, rollout documentation.
- Out of scope: forced app updates, account-level capability state, new queues, and canonical workout changes.

## Constraints

- Technical constraints: strict installed Swift decoders reject unknown fields and completed V6 messages; legacy URLs must remain below 2,048 characters.
- Product/process constraints: user approved preserving existing completed summaries while updated refresh/save clients use richer results. Backend release must not depend on iOS publication.

## Risks and mitigations

1. Risk: projecting an oversized saved result could falsely report a failed write.
   Mitigation: preserve successful apply status without its optional result; oversized read-only snapshots retain the existing rejected/workout_changed response.
2. Risk: one member uses both old and new devices.
   Mitigation: negotiate each authenticated status request; shared outbound messages always use the universally supported representation.

## Tasks

1. Reproduce default-client response and completed-message incompatibility.
2. Add bounded response projection and restore completed V4 transport without relaxing verified-editor attachment.
3. Verify old/new consumers, stable durable receipts, auth, and URL limits.
4. Update release evidence, run ReviewGPT round 3 with prior finding history, and merge after green CI.

## Decisions

- No-capability and unknown-capability requests use the legacy representation. Only X-Murph-Workout-Card-Format: envelope-v6 opts into direct results.
- Capability is presentation-only and is neither persisted nor used as authorization.
- Xcode 27 is installed and selected; native publication is no longer a backend release gate.

## Verification

- Commands: focused operator-config and Web route tests, relevant typechecks, frozen installed Swift decoder replay, complexity and docs checks, exact-head CI, ReviewGPT.
- Expected outcomes: old clients retain their supported behavior; capable clients receive full editors; no extra database/provider calls or durable state.

## Candidate evidence

- Six route regressions failed before projection and pass after it. Web route suite: 31 passing tests; operator-config workout-card suite: 11 passing tests.
- Attachment, outbox, channel runtime, and binding delivery: 274 tests pass on this candidate.
- Web typecheck passes after its normal Prisma generation step; operator-config typecheck passes. Complexity guard passes with no new debt.
- Compiled unmodified native model/decoder sources from iOS commit `143ec6108abc5eeae564e4aec9120c08565e843b` using Xcode 27 Swift with strict concurrency and warnings as errors. Eleven checks pass using synthetic output from the actual backend encoder/projection: active/completed message URLs and both legacy action results decode; old readers reject direct envelopes and completed V6 as expected. Scratch harness and fixtures are ignored local proof, not a second production decoder.
- Product UX: Ready for backward-compatible backend release. Existing active edits and completed summaries retain their protocols. Richer direct completed editors require a native request-header opt-in; native publication and physical Messages proof remain gates for that richer experience only.
- No new database/provider calls, persisted capability, dependencies, or auth changes. Exact-head CI and ReviewGPT round 3 remain PR-level merge gates.
Completed: 2026-09-22
