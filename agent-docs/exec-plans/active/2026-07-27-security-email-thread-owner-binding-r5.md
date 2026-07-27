# Bind direct hosted email replies to the Murph owner's verified address

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent sender-controlled email headers in a message sent to a personal Murph
  reply alias from redirecting the assistant's private direct reply to another
  address.
- Preserve personal reply-alias email as an owner-scoped conversation: accepted
  inbound mail still reaches the owner's assistant, and any direct reply goes
  only to that owner's current verified email.

## Success criteria

- Every direct hosted email provider dispatch, including serialized thread
  replies, resolves the current owner-controlled verified recipient immediately
  before provider entry.
- A serialized direct thread keeps its subject and message-reference metadata
  but cannot retain sender-controlled `To` or `Cc` recipients.
- Missing or unavailable current recipient authority fails before provider
  work, with the existing retryable pre-provider error.
- Group email fanout and non-email delivery paths keep their current behavior.
- Focused regression proof, canonical verification, preliminary specialists,
  final ReviewGPT, and exact-head PR CI pass.

## Scope

- In scope:
  - The existing assistant-runtime provider-entry email audience check.
  - Focused callback/delivery tests that prove direct thread rewriting and
    fail-closed behavior.
  - Current email security invariant wording if it does not already state the
    owner-only egress rule.
- Out of scope:
  - Dropping or disabling reply-alias ingress.
  - A second alias, sender-authentication, email-thread, or delivery subsystem.
  - Group newsletter recipient resolution or SMTP authentication redesign.

## Constraints

- Technical constraints: reuse the current verified-email authority callback
  and serialized thread-target type; do not trust `From`, `Reply-To`, `To`,
  `Cc`, raw authentication headers, or an old thread snapshot as owner proof.
- Product/process constraints: preserve the user-critical personal email reply
  flow and keep the correction deletion-first and owner-local.

## Risks and mitigations

1. Risk: rewriting a thread target loses reply threading.
   Mitigation: replace only its direct-recipient fields while preserving
   subject, message id, and references.
2. Risk: the fix accidentally rewrites group newsletter fanout.
   Mitigation: apply only when the delivery payload is direct email and keep
   group targets on their existing live group-recipient path.
3. Risk: recipient rotation creates a retry loop.
   Mitigation: use the existing provider-entry authority check and its current
   retryable pre-provider failure semantics.

## Tasks

1. [x] Independently validate the Round 5 ReviewGPT finding through ingress,
   mailbox import, outbox dispatch, and Cloudflare transport.
2. [x] Obtain one deletion-first ReviewGPT patch constrained to the existing
   verified-email authority owner.
3. [x] Inspect every hunk and simplify the accepted patch before local
   application.
4. [x] Add focused failing proof for a sender-controlled direct thread target,
   current-recipient rotation, missing authority, and preserved group behavior.
5. [x] Reconcile the durable email security invariant without duplicating
   architecture.
6. Run focused proof, affected typechecks, canonical diff verification,
   acceptance, preliminary specialists, parent review, final ReviewGPT, and
   exact-head CI.
7. Commit, push, and leave one separate draft PR unmerged.

## Decisions

- A leaked alias remains a private routing capability, as the durable security
  contract specifies; the fix does not disable alias ingress.
- The owner-only egress authority already exists at provider entry for new
  direct email. Extending that same owner to direct thread replies is the
  smallest correction.
- The accepted ReviewGPT patch changed only the runtime provider-entry helper,
  its focused tests, and the existing security invariant. Its downloaded
  SHA-256 matched the response, applicability and whitespace checks passed,
  and parent inspection retained the patch without adding state or a new
  authority boundary.

## Verification

- Focused assistant-runtime callback tests for direct email provider entry.
- Affected package typechecks.
- `pnpm test:diff packages/assistant-runtime apps/cloudflare`
- `pnpm verify:acceptance`
- Preliminary completion-specialists and final exact-head ReviewGPT/CI.
- Completed so far:
  - focused hosted-runtime callback suite: 200 tests passed
  - `@murphai/assistant-runtime` typecheck passed
