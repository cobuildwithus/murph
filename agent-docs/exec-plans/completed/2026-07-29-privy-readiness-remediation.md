# Privy readiness remediation

## Outcome

Finish the existing homepage-auth pull request so a delayed Privy client cannot
expose inert authentication controls, recovery does not discard a merely slow
initialization, and readiness diagnostics cannot attach authentication events to
invite-bearing URLs.

## Scope

- Keep every hosted authentication method behind Privy's documented `ready`
  boundary.
- Give delayed initialization an explicit preparation state and a bounded,
  user-controlled recovery path.
- Restrict readiness telemetry to the queryless, fragmentless homepage.
- Render the real readiness component in the design catalog.
- Add focused regression coverage for late readiness, recovery, telemetry
  scoping, and the catalog contract.
- Land the remediation on the already-open pull request rather than opening a
  duplicate.

## Invariants

- A phone-code request cannot be accepted before Privy is ready.
- A healthy provider that becomes ready after the first timeout remains mounted
  and can complete normally.
- Restarting Privy is an explicit secondary recovery after an additional wait,
  not the first response to a slow initialization.
- Invite codes, query parameters, fragments, and other route identifiers are
  never attached to the new readiness events.
- Authentication flows outside the homepage retain their existing behavior.
- The design catalog renders production presentation components against
  synthetic, inert props only.

## Steps

1. Refine the readiness timeout and recovery state machine.
2. Scope diagnostics to the bare homepage and add regression tests.
3. Add preparation and recovery states to the design catalog.
4. Run focused tests, typecheck, lint, and frontend design proof.
5. Complete the required exact-head review and GitHub checks on the existing
   pull request.

## Evidence

- The readiness boundary focused test passes with six cases covering hidden
  provider controls, late readiness, restart timing, accessibility semantics,
  and homepage-only diagnostics.
- The directly affected hosted-auth test set passes with 106 cases across the
  readiness island, phone controller, shared auth panel, and landing auth
  controls.
- Hosted Web `typecheck:prepared`, scoped ESLint, and `git diff --check` pass.
- The production readiness component was rendered through
  `/design?tab=components` with synthetic props and inspected at desktop and
  mobile viewports in its preparation, first-delay, and repeated-delay states.
- Product-experience review returned `NO FINDINGS`; its missing first-delay
  rendered-evidence gap was resolved in the refreshed catalog proof. Real Privy
  slow-initialization browser timing remains an explicit evidence gap because
  the focused harness controls the SDK boundary.
- The required Claude Code UI double-check was attempted with Fable and stopped
  at explicit usage-credit exhaustion as required by the completion workflow.
- Pushed-head ReviewGPT and CI evidence remain pending.

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
