# Repair main CI regressions

## Goal

Restore the hosted Stripe billing browser matrix by making its synthetic Starter
member satisfy the existing messaging requirement. Preserve production behavior.

## Root cause and scope

- Host Support run 33902609005 failed two assistant-engine assertions after
  the skill-router wording changed in PR #2814. PR #2818 independently corrected
  those assertions while this investigation was running; all 104 focused tests
  pass on main revision 7ed31fa5544309ade0988aacf84e79d5ffc6c072.
- Temporal compatibility run 33916476356 subsequently passed.
- Stripe run 33902608642 waited for starter enrollment without satisfying
  messaging setup. Since PR #2521, verified email alone does not satisfy that
  boundary. The fixture seeded only email and therefore correctly stayed on
  messaging setup instead of mounting the auto-enrollment island.
- Seed an optional synthetic verified phone through the canonical identity-field
  helper, and opt in only the Starter-to-paid browser scenario.
- Garmin run 33902608588 timed out connecting to its remote browser. Its fresh
  main run is separate hosted-provider evidence, not a billing regression.

## Verification

- Exercise the real seed helper with stubbed database writes and the production
  messaging-readiness function. Email alone must remain blocked; the synthetic
  phone must unblock readiness and preserve the fixture's app-auth identity.
- Run the existing billing support and messaging-state suites, Web and
  Cloudflare typechecks, focused ESLint, and the complexity guard.
- Required exact-head PR CI owns broad verification. The protected main Stripe
  workflow owns the full live sandbox matrix; no secrets are downloaded locally.

## Review and delivery

This changes only test fixtures and proof. Final ReviewGPT, Product UX, and the
public changelog are not applicable under the completion workflow's test-only
route. Parent final review, required CI, current-base merge proof, merge, and
post-merge verification remain required.

## State

Local validation passed: 26 focused tests, Web and Cloudflare typechecks,
focused Web ESLint, and the complexity guard. Parent final review found no
production behavior changes or unresolved defects. Exact-head PR CI and the
post-merge protected Stripe matrix remain the delivery evidence owners.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
