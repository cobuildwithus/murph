# Give Telegram Murph its iMessage contact number

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let Murph answer Telegram questions about its iMessage number with the
  member's assigned Murph line and a short, practical contact/group setup
  explanation.

## Success criteria

- Telegram conversation wakes carry the current member-assigned Murph text
  number when one exists.
- The assistant prompt identifies that trusted number as Murph's iMessage
  contact and tells the model to use it for contact or group-add questions.
- Missing numbers remain absent rather than guessed.
- Direct and authenticated group Telegram paths keep their current identity,
  route, privacy, and delivery behavior.
- Focused tests, canonical diff verification, acceptance verification, and
  required completion reviews pass.

## Scope

- In scope:
  - Telegram wake contract and parser projection.
  - Existing member-routing lookup projection.
  - Telegram assistant-input metadata and prompt rendering.
  - Focused Web, hosted-execution, assistant-runtime, and assistant-engine
    regression coverage.
- Out of scope:
  - New contact-card delivery or automatic outbound messages.
  - Changing Linq/iMessage routing or assigning a new line.
  - New storage, APIs, settings, or frontend UI.

## Constraints

- Use the existing encrypted member-routing phone source of truth.
- Never guess or hard-code a Murph phone number.
- Keep the optional field backward compatible across gradual Web/runner
  deployment.
- Do not expose member phone identity or provider credentials.

## Risks and mitigations

1. Risk: A user-controlled Telegram value could be presented as a trusted
   Murph number.
   Mitigation: Web derives the value only from decrypted member routing and the
   runtime accepts only normalized E.164-shaped phone data.
2. Risk: Old Web or runner versions disagree during deployment.
   Mitigation: Make the field optional; old producers omit it and old
   consumers ignore it.
3. Risk: Murph announces the number without relevance.
   Mitigation: Prompt guidance says to use it only for questions about
   contacting or adding Murph on iMessage.

## Tasks

1. [x] Add failing focused regressions for Telegram wake and prompt behavior.
2. [x] Carry the assigned Murph number through the existing optional contract.
3. [x] Run focused and canonical verification.
4. [ ] Complete required product, specialist, and final cross-cutting review.
5. [ ] Commit, push, open the PR, and close this plan.

## Verification

- Focused tests for:
  - Web Telegram wake production.
  - Hosted execution parsing/building.
  - Runtime assistant-input projection.
  - Assistant Telegram prompt rendering.
- `pnpm test:diff` for all touched source, tests, and plan paths.
- `pnpm verify:acceptance`.

## Results

- Focused Web, hosted-execution, assistant-runtime, and assistant-engine tests
  passed (221 tests).
- `pnpm verify:acceptance` passed, including 7,054 Web tests, 2,014
  Cloudflare tests, production builds, typechecks, lint, coverage, and guards.
- `pnpm test:diff ...` passed every changed owner before the existing
  hosted-local harness ordering issue: the command's earlier runtime test
  removed `packages/assistant-runtime/dist`, which the later harness requires.
  Rebuilding `@murphai/assistant-runtime` and rerunning the exact blocked
  harness passed (410 tests, 1 skipped).
- Product-experience review returned `NO FINDINGS`. No rendered UI evidence is
  applicable.
- Follow-up review narrowed the source to the member's existing
  `linqRecipientPhone` only. A pending pre-activation line is deliberately
  omitted, and the Telegram read path never queries or claims the assignable
  Linq line pool.
