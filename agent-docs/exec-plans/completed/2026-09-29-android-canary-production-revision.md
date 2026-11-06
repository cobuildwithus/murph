# Select the deployed Android canary revision

## Outcome and invariants

Run the Android production canary when protected main is ahead of the deployed
Web revision. Keep exact production verification, protected-main ancestry,
immutable native source pins, dispatch fencing, and hosted-only credentials.

## Evidence and owner

The Android controller rejects a deployed revision different from the cron
revision before native dispatch. The iOS controller already selects the actual
production alias, proves its ancestry and deployment, and rechecks at dispatch.
Reuse that workflow sequence and exercise both controllers in the existing
executable production-selection test. No new state or auth authority is needed.

## Scope and proof

- [x] Reuse the production selection sequence and update owner docs.
- [x] Both native controller suites passed (26 tests); tooling typecheck,
  docs drift, complexity guard, and whitespace validation passed.
- [x] Parent reviewed the focused change and preserved credential/dispatch
  boundaries. Exact-head external review and CI continue in the PR.

First-party native login remains separately blocked on a CI-accessible OTP
inbox. This change does not claim successful authentication or health sync.
The private Garmin and public scheduled-repair PRs are merged; subsequent
Garmin and Frog scheduled runs passed. Linq remains outside this task.
Status: completed
Updated: 2026-09-29
Completed: 2026-09-29
