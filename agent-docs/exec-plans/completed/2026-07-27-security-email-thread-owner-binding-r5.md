# Bind direct hosted email replies to the Murph owner's verified address

Status: completed
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
- Focused regression proof, canonical verification, acceptance reconciliation,
  preliminary specialists, parent review, and implementation-head PR CI pass.
- Immutable final ReviewGPT and fresh CI run on the plan-closing head before
  merge.

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
6. [x] Run focused proof, affected typechecks, canonical diff verification,
   acceptance, preliminary specialists, parent review, and implementation-head
   PR CI.
7. [x] Close the implementation plan with one separate draft PR still
   unmerged; the immutable final ReviewGPT gate and fresh CI run after this
   plan-closing commit.

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

- Rebased focused hosted-runtime callback suite covering direct email provider
  entry: 202 tests passed.
- `@murphai/assistant-runtime` typecheck passed.
- Canonical diff verification:
  - `pnpm test:diff packages/assistant-runtime apps/cloudflare` passed.
  - Assistant runtime: 77 files passed, 1,924 tests passed, 2 skipped.
  - Cloudflare node: 108 files and 2,013 tests passed.
  - Cloudflare workers: 2 files and 2 tests passed.
- Acceptance:
  - `pnpm verify:acceptance` completed all owners but returned nonzero only for
    two unchanged contention-sensitive tests outside this PR's diff:
    `apps/web/test/hosted-preference-handoff-sweeper.test.ts` and
    `packages/assistant-runtime/test/hosted-runtime-clinical-records.test.ts`.
  - Immediate isolated reruns passed 9/9 and 35/35 respectively, proving no
    reproducible branch regression.
- Completion reviews and CI:
  - Preliminary completion-specialists returned PASS with no findings or
    patch.
  - The parent final review found no remaining accepted issue after re-reading
    the full diff, provider-entry call path, live Web recipient authority,
    Cloudflare transport recipient selection, and group-fanout bypass.
  - PR CI on the implementation head is green.
  - The immutable final ReviewGPT gate and fresh CI run after the plan-closing
    commit; the PR remains draft and unmerged.
Completed: 2026-07-27
