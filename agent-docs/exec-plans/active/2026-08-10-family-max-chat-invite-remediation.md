# Family Max chat invitation remediation

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make first-time Family Max invitations from private chat complete and
  recoverable when the owner has no already-paid Max capacity.
- Keep seat purchase and billing consent in the existing authenticated Family
  Settings owner; do not add chat-side charging or another state owner.

## Success criteria

- The Family skill reads current status before every invitation and calls
  `create_invite` exactly once only when the requested tier has remaining paid
  capacity.
- Zero-capacity requests create no invite from chat and direct the owner to the
  existing Family Settings purchase-and-invite flow without claiming success.
- A post-preflight error or ambiguous transport result is described as
  unconfirmed and does not encourage a blind duplicate.
- Focused Assistant Engine tests and typecheck pass, followed by exact-head
  ReviewGPT and required GitHub Actions.

## Scope

- In scope: the Murph Family skill invitation policy, Family dynamic-tool
  ambiguous-error wording, focused contract/execution coverage, PR intent and
  review evidence, and current-base reconciliation.
- Out of scope: automatic seat purchase from chat, a new tool action, persisted
  preflight state, changing Web's authoritative capacity rejection, or adding
  another billing/invitation owner.

## Constraints

- Technical constraints: reuse `read_status`, `plans.<tier>.remaining`, the
  existing `create_invite` mutation, and the stable authenticated Family
  Settings handoff.
- Product/process constraints: retain explicit billing consent, never claim an
  invitation or charge without authoritative confirmation, and preserve the
  previously completed Family Max rollout/rollback contracts.

## Risks and mitigations

1. Risk: a status preflight becomes stale before invitation mutation.
   Mitigation: keep Web's transaction-scoped capacity check authoritative and
   make a rejection or transport ambiguity explicitly unconfirmed and
   duplicate-safe.
2. Risk: chat becomes a second seat-purchase owner.
   Mitigation: zero-capacity requests only navigate to Family Settings, whose
   existing confirmation flow remains the purchase-and-invite owner.

## Tasks

1. Prove the accepted ReviewGPT finding through the skill, dynamic tool, Web
   handler, and capacity-rejection path.
2. Add the smallest skill and error-recovery correction with focused tests.
3. Merge current `main`, run focused verification, update the PR intent
   contract, commit, and push the exact candidate.
4. Run the next final ReviewGPT round concurrently with exact-head CI; resolve
   accepted findings, archive this plan, merge the authorized PR, and retire
   the worktree.

## Decisions

- Accepted the fresh full-snapshot round-4 Material UX finding. Existing Family
  subscriptions ordinarily begin with no Max capacity, so a direct Max invite
  can reach Web's correct capacity rejection while the assistant exposes only
  a generic failure.
- Keep the correction prompt- and recovery-level. The current Web transaction,
  Settings dialog, and webhook reconciliation already own the correct state
  transitions; a composite tool or compatibility state would duplicate them.
- A prior concurrent worker archived the original Family Max plan before this
  later recovery audit returned. That completed snapshot remains immutable;
  this active plan owns only the accepted remediation and completion gate.

## Verification

- Focused Assistant Engine Family tool and skill coverage: 10 tests passed.
- Assistant Engine typecheck passed.
- `git diff --check` and the private-identifier diff scan passed.
- The repository exposes no ESLint executable, so the attempted focused ESLint
  command could not run; typecheck and focused Vitest are the next-best local
  validation.
- Pending: exact pushed-head final ReviewGPT and required GitHub Actions.
