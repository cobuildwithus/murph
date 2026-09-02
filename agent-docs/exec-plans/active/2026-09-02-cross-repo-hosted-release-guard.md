# Cross-Repository Hosted Release Guard

## Outcome

Prevent a public `main` revision from reaching production without one
cost-bounded hosted foreground proof against the exact private `main` revision
that will consume it. Pull requests retain the fixture-only Temporal
compatibility gate from #2683; the heavier executable proof begins only after
the public revision is trusted `main` and before Vercel promotes it.

## Root Cause

The warm-standby regression passed public CI because its unit test repeated the
new implementation's broad eligibility assumption. The deployment admission
proved reader fixtures only, while the private hosted integration matrix left
standby allocation off. No release owner bound the activated foreground
scenario to the exact public and private revisions before production
promotion.

## Constraints

- Preserve the private repository as a one-way consumer of released public
  runtime contracts. Private CI must never check out or execute public
  pull-request candidate code; hosted release admission accepts exact public
  `main` only.
- Keep credentialed controller code on trusted default branches; never execute
  candidate-controlled code beside a writable token, OIDC identity, production
  secret, protected environment, or private source checkout.
- Bind every authoritative result to exact 40-character public and private
  SHAs and fail closed when either identity moves or the receipt is incomplete.
- Run one targeted private E2E lane for each public production candidate. Do
  not add a queue, lease service, scheduler, database, or long-lived controller
  state.
- Force and observe `HOSTED_EXECUTION_STANDBY_MODE=allocate` for the hosted
  foreground-priority proof. Defaults are not evidence for an opt-in branch.
- Reuse the existing Temporal deployment controller, private `Public Murph
  Integration` workflow, foreground-priority scenario, and Vercel Deployment
  Check. Do not create a second pull-request status or deployment owner.
- Provider-owned Vercel Environment and Deployment Check settings remain
  explicit rollout work rather than self-reported repository configuration.

## Work

- [x] Inspect and disposition the ReviewGPT attachment against current public
  and private heads, repository ownership, and security rules.
- [x] Extend the existing trusted exact-main deployment dispatch and receipt
  validation with a closed hosted release mode.
- [x] Extend the private integration workflow with one targeted release mode,
  an independently derived exact-pair receipt, and exact public/private `main`
  validation before and after the proof.
- [x] Move the existing integration matrix data into one private manifest so
  automatic private CI retains every lane while release admission selects only
  the canonical foreground lane.
- [x] Prove the foreground lane receives and observes allocation mode, including
  the corrected standby eligibility truth table from the landed regression fix.
- [x] Update canonical security, reliability, testing, and deployment contracts
  for the implemented owner model.
- [ ] Run focused local proof in both repositories, inspect privacy and diff
  shape, commit through the scoped plan path, and open paired draft PRs.
- [ ] Complete both repositories' exact-head CI and ReviewGPT gates before
  merge; retarget the public PR to `main` only after #2683 lands.

## Product UX

Not applicable. This is an internal release-safety workflow with no
member-visible product or interface change. The operator keeps one pre-merge
compatibility status and one production Deployment Check; only the latter adds
the targeted hosted execution proof.

## Verification

- Public controller and workflow contract tests cover closed dispatch modes,
  exact pair identity, stale-head rejection, failed and missing receipts,
  dispatch/run identity, cancellation, and deployment admission wiring.
- Public manifest tests cover the private JSON scenario source and required
  canonical foreground lane.
- Hosted-local environment tests prove explicit allocation reaches generated
  Wrangler configuration and is observable by the foreground scenario.
- Private workflow tests cover exact release inputs, targeted matrix selection,
  automatic full-matrix retention, aggregate failure, trusted receipt
  derivation, and exact public/private `main` revalidation.
- Run the smallest focused Node/Vitest checks for every touched controller,
  workflow, harness, and documentation surface, plus required package
  typechecks. Exact-head GitHub Actions own the broad suites.

## Deployment Concerns

Land the private release-mode support first. After #2683 lands, retarget and
land the public controller so `Temporal Web production admission` requires both
the existing live-reader proof and the exact-main foreground hosted proof.
Confirm one public `main` candidate blocks when the foreground proof fails and
passes only when standby allocation is explicitly observed. The existing
Vercel Deployment Check binding remains the production authority.

Status: active
Updated: 2026-09-02
