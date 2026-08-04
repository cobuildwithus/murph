# Include de-identified issue text in support escalation alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Include the bounded, de-identified product issue captured for an explicit
  private-member support escalation in the immediate internal support alert,
  while keeping raw conversation, health, contact, and secret-bearing context
  out of the member-linked row and email.

## Success criteria

- Eligible support alerts render the stored anonymous issue summary together
  with the existing internal feedback and member identifiers.
- Exact callback replay reuses the same stored issue text and Resend idempotency
  key; a conflicting replay fails before provider entry.
- The member-linked feedback row remains fixed server-authored metadata, the
  anonymous detail row remains the only durable free-text owner, and daily cap,
  verified-private-member authority, and plain-text delivery behavior remain
  unchanged.
- Focused Web tests, app typecheck, direct payload proof, required ReviewGPT
  gates, exact-head CI, and parent final review pass.

## Scope

- In scope: hosted Web product-feedback persistence/readback, support alert
  formatting, focused tests, and the durable product/security/reliability docs
  that define the disclosure.
- Out of scope: raw transcript inclusion, schema changes, recipient or sender
  changes, daily digest behavior, member-facing confirmation copy, new retry or
  queue ownership, and provider/deployment changes outside `apps/web`.

## Constraints

- Technical constraints: use the already normalized and scrubbed support detail
  row; derive retry email content from stored state; preserve the three-per-UTC-
  day cap and stable provider idempotency key; add no state owner or dependency.
- Product/process constraints: this is a semantic product and private-data
  exposure change, so it uses the worktree/PR lane, product-experience and
  coverage specialist lenses, the final ReviewGPT cross-cutting gate, exact-
  head CI, and a scoped final commit.

## Risks and mitigations

1. Risk: a model-authored summary can retain semantic private detail even after
   deterministic scrubbing.
   Mitigation: email only the same bounded de-identified product-only summary
   admitted by the existing model/tool contract; keep the raw conversation and
   the reserved prefix out of the email, and retain explicit forbidden-content
   documentation and regression proof.
2. Risk: an idempotency-key replay with changed issue text could reuse one
   provider key with a different body.
   Mitigation: read and validate both deterministic stored rows, format from the
   stored detail row, and reject conflicts before Resend.

## Tasks

1. Prove the existing persistence, email, replay, and privacy path.
2. Extend the existing Web owner to validate and render the stored issue detail.
3. Update focused regressions and the owning durable docs.
4. Run focused verification and direct payload proof; inspect the complete diff.
5. Commit, push, open a PR, run the required specialist/final ReviewGPT and CI
   loops, resolve findings, close the plan, and finish the scoped commit.

## Decisions

- The email will contain the normalized issue content after the reserved
  `Support escalation:` prefix, labeled as a de-identified product issue.
- The anonymous detail row remains the single durable text owner; the linked row
  stays fixed server-authored metadata.
- Provider retries will format from read-back stored detail rather than the
  callback payload.

## Verification

- Commands to run: focused `apps/web` Vitest for support escalation and its
  callback route, `apps/web` typecheck, `git diff --check`, a direct formatter
  assertion through the focused suite, and required exact-head CI.
- Expected outcomes: the alert includes the de-identified issue once, excludes
  the reserved prefix and forbidden raw context, exact replay keeps the same
  body/key, conflicting replay fails before email, and all existing authority,
  rate, anonymous-row, and failure cases remain green.
