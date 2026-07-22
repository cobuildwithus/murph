# Family member usage top-up

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Let a Family plan owner select an active Family member in Settings and buy a
  fixed $5, $10, or $25 usage-credit increment for that member.
- Reuse the existing usage-credit purchase, Stripe Checkout, webhook grant,
  status, expiration, refund, dispute, and dialog primitives.

## Success criteria

- The authenticated Family owner is the payer and the selected active,
  unsuspended same-Family member is the frozen beneficiary.
- Checkout uses the Family group's existing Stripe billing customer and never
  creates or revives the owner's personal customer.
- Personal, public-group, and Family owner-self targets cannot recover one
  another as the same checkout.
- Mutable Family membership gates only new purchase creation; an already-frozen
  paid purchase still fulfills to its original beneficiary.
- The Family member row composes the existing top-up dialog and names the exact
  beneficiary in its accessible trigger, dialog title, and status copy.
- Focused service, route, UI, reconciliation, and durable-documentation proof
  passes the repository's required verification and review gates.

## Constraints

- Add no Family wallet, second credit ledger, schema, dependency, or webhook
  branch.
- Treat browser member ids, return parameters, and offer codes only as selectors;
  rebind authority and price facts on the server.
- Preserve the payer-wide one-nonterminal-purchase invariant and existing
  beneficiary-locked grant path.
- Keep the concurrent `hosted-usage-top-up-dialog.tsx` presentation redesign
  untouched apart from the smallest additive Family target-context API needed
  to prevent an ambiguous payment action.
- Preserve unrelated worktrees, ledger rows, and current main-checkout edits.

## Plan

1. Trace the purchase target, Family authority/billing, active-purchase
   projection, Settings page, and existing route/component tests.
2. Add the smallest Family target resolver and checkout route over the shared
   purchase creator, including distinct frozen target identity/return scope.
3. Compose the existing top-up dialog from the Family manager with server-owned
   offers and payer-wide recovery data.
4. Add focused regression proof and update architecture/security/reliability
   documentation.
5. Run diff verification, coverage/frontend specialist audits, rendered direct
   proof, second-model UI review, parent final review, scoped commit, PR CI, and
   the pushed-head ReviewGPT loop.

## Evidence

- ReviewGPT confirmed the existing `payerMemberId` / `beneficiaryMemberId`
  model, beneficiary ledger, and webhook grant already support this feature.
- ReviewGPT identified an owner-self collision if target matching compares only
  payer and beneficiary: personal self top-up and Family-funded self top-up use
  different Stripe customers and return scopes.
- The frontend completion review proved that the existing public props could
  not identify a Family beneficiary after the member column scrolls out of
  view. This task adds target context without restyling the concurrent dialog.
- `coverage-write` added owner/group/member authorization, missing-billing, and
  unpaid-owner offer proof; its focused 138-test lane passed.
- The first `frontend-review` found beneficiary ambiguity and a terminal
  former-member recovery lifecycle bug. Both were fixed, focused component
  coverage passed, and the required remediation review returned no findings.
- Final `pnpm test:diff apps/web` passed TypeScript, 6,142 tests, lint with zero
  errors, dev smoke, and the production Next build.
- The isolated frontend server and Family fixture started, but the in-app
  browser reported no available browser backend. Full hosted-local startup was
  independently blocked by the runner entrypoint's pre-existing byte budget,
  so real desktop/mobile rendering remains an explicit verification gap.
- The required Fable review attempt reported exhausted Claude usage credits;
  the completed task-scoped Codex `frontend-review` is the documented
  substitute.
- Final `pnpm verify:acceptance` passed the full workspace typecheck, package
  coverage, hosted-web and Cloudflare app verification, production builds, and
  package-boundary gates.
- The parent final review re-read the complete diff and walked fresh creation,
  exact replay, active-purchase conflict, return routing, fulfillment, and
  recovery paths; it found no remaining actionable issue.
Completed: 2026-07-22
