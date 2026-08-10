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
- `start_checkout` establishes inactive Family billing only; it cannot accept,
  create, prepare, or report an invitation.
- A durable pending Max member transition is documented and tested as the
  earliest Web rollback floor, even before Max Stripe or capacity state exists.
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
- Round 5 accepted one review-induced wording bug: the shared Family tool catch
  applied mutation-only duplicate warnings to a failed `read_status`, even
  though a read cannot create an invite, checkout, or charge. The existing
  catch now branches on the request action: reads state that no change was
  attempted and permit a safe status retry, while potentially mutating actions
  retain the unconfirmed/Settings recovery.
- A later round-5 full-patch result exposed the remaining duplicate invitation
  path: `start_checkout` could still carry invite context and mutate an invite
  for an already-active owner, bypassing the status-first experience.
- Delete that duplicate path. `create_invite` is the sole invitation mutation;
  `start_checkout` now owns only billing establishment. The runner parser keeps
  one bounded rollout allowance for the old Web build's two null response keys,
  rejects non-null legacy invite results, and exposes neither field.
- Round 6 returned `PASS` for the pre-ownership-correction head. Round 7 then
  accepted one review-induced rollout disclosure gap: Web durably records
  `pendingPlanCode: "max"` before Stripe mutation or Max capacity state. Treat
  that pending intent as the earliest Web rollback floor, prove the legacy
  reader rejects it while the current snapshot reader accepts it, and keep the
  runtime floor distinct because pending transition state is not projected to
  the runner.

## Verification

- Focused Assistant Engine Family tool and skill coverage: 10 tests passed.
- Assistant Engine typecheck passed.
- `git diff --check` and the private-identifier diff scan passed.
- The repository exposes no ESLint executable, so the attempted focused ESLint
  command could not run; typecheck and focused Vitest are the next-best local
  validation.
- Round-5 correction rerun: 11 focused Family tool and skill-policy tests
  passed; Assistant Engine typecheck, `git diff --check`, and the private-
  identifier diff scan passed.
- Duplicate-path correction: 15 Assistant Engine schema/execution/skill tests,
  18 tool-description contract tests, 64 hosted-execution parser tests, and 6
  Web Family tool tests passed in the exact PR worktree.
- Assistant Engine, Hosted Execution, and Web typechecks passed.
- Pending-Max rollback disclosure correction: 188 focused Web owner-snapshot
  and member-transition tests passed; Web typecheck, `git diff --check`, and
  the private-identifier diff scan passed. The owner-snapshot file then passed
  all 15 tests with the final explicit Pulse-only/zero-Max capacity assertions.
- Exact pushed head `4efbb4c1b1b14deed3059b544b085e51ca7008a9` passed every required
  GitHub Action before the round-7 rollback-disclosure correction.
- Round 7 inspected that exact head and returned only the pending-Max rollback
  floor finding recorded above.
- Pending: push the correction, run the round-7 disclosure-only verification
  retry, and pass final-head GitHub Actions.
