# PR 1039 participant-authority review remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Resolve the final ReviewGPT finding that SMS roster admission makes the existing Linq participant-access reconciliation reachable.

## Success criteria

- The durable spec and PR intent contract state that `read_chat_participants` refreshes the existing bounded participant-access projection.
- Regression proof composes the route-authorized SMS request shape with Web reconciliation, the resulting access decision, and a denied contact-card continuation with no provider effect.
- Effectful SMS actions remain unavailable.
- The exact remediation head passes focused and canonical verification, CI, and a correction-verification ReviewGPT round.

## Scope

- In scope: focused assistant-runtime and Web regression tests, the address-book advisory-names spec, its index entry, and PR completion metadata.
- Out of scope: a new state owner, a new wire contract, participant-access redesign, contact-card enablement for SMS, or provider behavior changes.

## Constraints

- Keep the existing seven-day participant-derived Linq access lease and its canonical reconciliation owner.
- Treat the runtime SMS admission and Web participant reconciliation as one documented behavior.
- Keep contact-card sharing and every other chat effect iMessage-only.
- Preserve the immutable first-reviewed head and change-shape baseline for PR 1039.

## Evidence

- The original service filter entered with the iMessage-only contact-card and participant-read feature.
- Participant reconciliation entered later as a Linq-wide container-liveness projection and already runs after SMS group route provisioning.
- Authenticated group inbound renews an existing participant lease regardless of Linq service.
- The first-reply group skill may call `read_chat_participants` automatically and then attempt `share_contact_card`; the runtime withholds SMS thread authority from the latter.

## Tasks

1. [completed] Register the remediation and correct the durable intent claims.
2. [completed] Add focused proof for the reachable reconciliation, access, and denied-effect sequence.
3. [completed] Run focused and canonical verification.
4. [in progress] Commit, push, update the PR contract, and complete ReviewGPT round 2 with CI.

## Decision

- Accept the final-round finding as an intent-contract and regression-proof gap.
- Keep the production change. The iMessage-only filter came from the original
  contact-card feature, while participant reconciliation was added later as a
  Linq-wide container-liveness projection.
- Do not add a service field, state owner, or read-only fork. SMS group
  provisioning and authenticated participant inbound already maintain the same
  bounded projection.

## Verification

- Focused assistant-runtime service-boundary test: 17 passed.
- Focused Web group-tool and canonical participant-access tests: 113 passed.
- `pnpm docs:drift`: passed.
- Canonical `pnpm test:diff`:
  - repository guards and workspace boundaries passed;
  - assistant-runtime typecheck passed;
  - assistant-runtime tests passed (1,901 passed, 2 skipped);
  - Web typecheck, lint, dev smoke, and production build passed;
  - Web tests passed (6,880 passed, 188 skipped);
  - Cloudflare Node tests passed (2,012);
  - Cloudflare Workers tests passed (2).
- `git diff --check` and identifier scans passed.
Completed: 2026-07-27
