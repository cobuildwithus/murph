# Hosted Linq Dual Send Repro

Status: verified; ready for discussion
Created: 2026-05-20
Updated: 2026-05-20

## Goal

Diagnose and locally reproduce why hosted Linq auto-replies can be physically
sent more than once when the post-delivery workspace checkpoint is not durably
accepted.

## Success Criteria

- The investigation distinguishes Linq provider/request idempotency from Murph's
  higher-level user-visible "same reply" idempotency.
- A focused hosted-local E2E reproduces the observed duplicate-send window or
  proves the current local harness cannot model it.
- The repro records whether duplicate sends use the same or different Linq
  `idempotency_key` values without logging provider secrets, payload bodies in
  docs, local paths, or identifiers.
- Required focused verification passes, or blockers are recorded.

## Scope

- In scope:
  - Hosted Linq auto-reply idempotency key construction.
  - Hosted runtime post-assistant delivery/checkpoint ordering.
  - Existing hosted-local Linq E2E harness coverage.
- Out of scope:
  - Production data mutation.
  - Broad hosted runner or artifact snapshot rewrites.
  - Disabling Linq sends without a durable resend strategy.

## Constraints

- Preserve overlapping hosted runner, artifact snapshot, and web security work
  already dirty in the tree.
- Keep evidence metadata-oriented and redacted.
- Prefer a diagnostic repro over a fix until the root cause and safe correction
  are agreed.

## Plan

1. Reconfirm the hosted Linq idempotency key inputs and post-delivery checkpoint
   ordering.
2. Inspect hosted-local Linq scenario support for controlled replay/checkpoint
   failure hooks.
3. Add the narrowest hosted-local repro or, if the full stack cannot force the
   failure, add a focused regression at the nearest runtime boundary and note the
   missing harness primitive.
4. Run the focused hosted-local/test command for the touched surface.
5. Summarize root cause and fix options.

## Verification

- Passed:
  - `MURPH_HOSTED_LOCAL_LINQ_REPLAY_REPRO=1 MURPH_DEV_SKIP_RUNNER_BUNDLE=1 MURPH_DEV_SKIP_RUNNER_DOCKER_BASE=1 pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts --no-coverage -t "reproduces duplicate visible Linq sends"`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check`

## Result

- The focused hosted-local E2E now reproduces the duplicate visible-send window.
- The repro is opt-in with `MURPH_HOSTED_LOCAL_LINQ_REPLAY_REPRO=1` because it
  models an unresolved timing-sensitive failure window and should not block the
  default hosted-local acceptance suite.
- The test observes the first Linq send, rewinds the hosted workspace to a
  checkpoint that omits the delivery receipt, appends a second inbound Linq
  message, and observes another outbound Linq send with the same visible reply
  text.
- The two Linq requests carry different non-empty `message.idempotency_key`
  values matching the hosted `sha256:` key shape. This confirms the provider is
  not failing same-key idempotency; Murph is deriving a new provider key when
  replay grouping changes.
- The immediate root cause is that hosted auto-reply delivery identity includes
  the grouped inbound hosted mailbox item IDs. A lost receipt checkpoint can let
  replay group a previously-sent turn with a new inbound item, creating a
  different higher-level delivery identity and therefore a different Linq
  provider idempotency key.

## Fix Direction

- Keep Linq request idempotency, but make Murph's user-visible reply identity
  stable across checkpoint loss and replay grouping changes.
- Do not resend a completed visible reply merely because the post-delivery
  checkpoint failed. Retrying the same provider key is acceptable; recomputing a
  different key for the same visible reply is the unsafe path.
