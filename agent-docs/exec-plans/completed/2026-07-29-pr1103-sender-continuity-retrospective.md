# PR 1103 sender continuity retrospective

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

Finish the Telegram-to-iMessage handoff without claiming continuity that the
system cannot prove.

## Requirement-level retrospective

- The original user requirement is one stable Murph line per member: return an
  existing line first and let a first explicit Telegram request consume at most
  one healthy line.
- Round 1 exposed a separate same-member problem: an arbitrary first iMessage
  sender does not necessarily resolve to the Telegram member.
- The first remediation checked for any verified phone or account email.
  Round 2 proved that this was still existential evidence, not evidence for the
  exact sender Linq will carry on the first iMessage.
- Exact continuity for every iMessage sender would require a new pairing
  protocol or persisted sender authority. That is beyond the requested
  one-number handoff and would add a second product mechanism.
- Decision: keep one-number allocation as the hard guarantee and deliberately
  narrow automatic continuity to the member's exact verified phone identity.
  A verified account email alone is not eligibility because it does not prove
  the active iMessage sender setting.
- On success, the signed current-input tool returns only the existing masked
  verified-phone hint alongside Murph's line. The assistant must tell the
  member to start iMessage from that verified phone and state that another
  number or email is not guaranteed to resolve to the same account and may
  start a separate Murph conversation.
- A member without a verified phone receives the existing Settings recovery
  step and consumes no line. An inbound from a different identity remains the
  ordinary first-contact flow, but the handoff no longer promises or implies
  continuity for that path.
- No new persisted field, pending route, pairing token, queue, reconciliation
  owner, or compatibility layer is introduced.

## Success criteria

- Only an exact verified member phone makes the tool eligible to return or
  assign a Murph line.
- Every successful result carries a bounded masked phone hint and the assistant
  states the exact sender constraint and mismatch consequence.
- Email-only and unverified-phone members receive `identity_required` before
  route-specific locking, pool access, or writes.
- Existing-number reuse and concurrent first assignment still consume at most
  one line.
- Durable docs, focused coverage, product review, canonical verification,
  ReviewGPT correction verification, and replacement CI pass.

## Tasks

1. [x] Narrow eligibility and the success contract to verified phone identity.
2. [x] Add exact assistant guidance and regression coverage.
3. [x] Update durable docs and rerun product review.
4. [x] Run canonical verification and package the remediation for PR gates.

## Verification

- Focused hosted-execution, Assistant Engine, Web, and Cloudflare tests passed.
- Product-experience review passed after Web began proving that the verified
  phone and blind lookup key match and the assistant changed the mismatch copy
  from an absolute claim to a bounded continuity warning.
- `pnpm test:diff` passed for every changed owner and affected dependent,
  including 2,830 Assistant Engine tests, 1,953 Assistant Runtime tests, 1,084
  CLI tests, 7,378 Web tests, 2,102 Cloudflare Node tests, 3 Cloudflare Workers
  tests, Web lint with zero errors, dev smoke, and production build.
- `pnpm verify:acceptance` passed all package coverage, Web and Cloudflare
  verification, and fixture smoke coverage for 204 scenarios.
- ReviewGPT correction verification and exact-head GitHub CI as post-plan PR
  gates.
Completed: 2026-07-29
Completed: 2026-07-29
