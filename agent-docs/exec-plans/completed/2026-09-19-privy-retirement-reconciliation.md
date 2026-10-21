# Reconcile Privy retirement with current authentication

Status: completed
Created: 2026-09-19
Updated: 2026-09-19

## Goal

Prepare PR #3134 against current main while preserving first-party login,
bound reauthentication, first-passkey setup and protected account recovery.
Keep contraction gated on browser-session drain, account disposition, provider
cleanup obligations and recorded native qualification.

## Success criteria

- Resolve the adoption-squash merge and all newer authentication dependencies.
- Prove canonical first-passkey enrollment, session revocation, established
  factor protection and reauthentication without legacy schema or SDKs.
- Pass focused PostgreSQL/client tests, typecheck and required review/CI.
- Record the actual rollout inventory and retain explicit release gates.

## Scope and constraints

Update the existing owned retirement branch without rewriting its published
history. Preserve immutable completed plans. Keep shared HMAC configuration for
billing and devices. Production sessions must expire before schema removal;
no forced logout or unproved store/device qualification is implied.

## Tasks

1. Merge current main and resolve source, schema, test and documentation conflicts.
2. Unify first-passkey setup on the newer canonical bound-login safeguards.
3. Remove new provider-only paths introduced since the original retirement.
4. Verify and review the contracted implementation; retain draft until ready.
5. Update the retirement/native inventory and remaining external gates.

## Decisions

- The adoption stack was squash merged. Content reconciliation uses its adopted
  head as the three-way base, with an ordinary merge commit retaining published
  retirement history and current main as parents.
- First-passkey setup retains canonical login generation checks and revokes
  other first-party sessions. It never overwrites an existing approval aggregate.
- PR #3589 owns separately deployable targeted signup cleanup. PR #3221 is
  closed as obsolete; its branch remains preserved.

## Verification

Focused auth PostgreSQL, passkey enrollment, reauthentication, client cancellation
and action-approval tests; contracted Prisma generation and web typecheck;
scoped lint, docs/complexity checks, exact-head CI and full ReviewGPT.

## Reconciliation evidence

All 1,811 affected non-PostgreSQL cases pass after correcting two stale fixtures.
All 297 changed PostgreSQL cases pass before and after actual schema contraction
in an isolated synthetic database. Transactional guard probes refuse live legacy
sessions, unimported identities and unfinished provider receipts before drops.
Web typecheck, complexity and documentation checks pass. The four composed
Chromium action-approval journeys pass at mobile and desktop sizes, covering
fresh proof and inline reauthentication cancellation/retry. Channel design proof
also passes at 390px and 1440px using the current first-party settings component.

Initial enrollment now owns both new and imported members with no approval
aggregate. New-user creation no longer stamps a revocation for authority that
never existed; subsequent credential revocations and enrollment keep the existing
fence. A later credential fence requests bound reauthentication before setup.
The temporary operator cleanup release is deployed; execution still waits for
session expiry. No production account deletion, contraction or native publication
has run.

- Merged additive preparation #3589 after valid review and green required CI. Integrated its main commit, retaining the calendar-stable video fixture correction and immutable completed plan; removed its temporary Ops endpoint, guard and optional deletion mode from retirement readers. Production execution remains pending session expiry.

## Final review and CI correction

Full sensitive round 3 passed at `12bd39220dd5a3e06dfa916227b62e28cedc1134`.
The completed capture binds the accepted turn, actual gpt-6-pro response and
SHA-256 `5d178422f19fece439a60e8d27d1e64699d78f7f3fd2e5ce0988b6755b2350ea`.
CI exposed two fixture omissions: a newer runtime-enrollment fixture still wrote
the removed provider receipt column, and a Cloudflare full-stack fixture omitted
the two first-party harness keys. Corrected only those fixtures and retired two
unused receipt-test fields. The 29-case PostgreSQL/cleanup run, 29-case harness
run, Web/Cloudflare typechecks and scoped lint pass. No runtime source changed
since the full review; all hosted checks passed at `638aaf2cbaf1c5bdb96fd4337b992a5e098d692b`.

## Completion and operational handoff

Web code preparation is complete. Full sensitive review passed, all required
source-head CI passed, and merge-tree verification against freshly fetched main
`261ff4ff82` is conflict-free. This final commit only closes the plan and refreshes
the durable rollout record; its final-head CI remains a delivery gate.

Android retirement has validated PASS and green CI; its CI cleanup remains
stacked after it. iOS retirement has passing current simulator tests/builds and
is completing its final review after deleting an unused diagnostic adapter.
Native store distribution, installed upgrades and dormant/skipped-version
recovery are still external qualification gates. The additive guarded signup
cleanup and Android SDK package correction are merged; the former is deployed.
No production deletion, forced logout, vendor/configuration retirement or schema
contraction was performed. Browser authority must drain naturally, the signup
must be eligible at execution, and provider-orphan/wallet obligations must be
recorded before final retirement. Keep the shared HMAC key.
Completed: 2026-09-19
