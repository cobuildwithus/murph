Goal (incl. success criteria):
- Let the iOS companion explicitly enroll in automatic meal-photo capture and upload only locally classified meal JPEGs through a production-safe, installation-scoped credential.
- Preserve the privacy boundary: no historical-library scan, no broad app-session bearer in the background extension, strict image validation, private temporary storage, deterministic dedupe, and revocation that fails closed.
- Success means the released companion can complete setup, a valid scoped upload reaches the member's canonical hosted mailbox/runtime path exactly once, invalid or revoked uploads fail, focused and scoped verification pass, and both deploy surfaces remain backward compatible during rollout.

Constraints/Assumptions:
- Hosted web remains owner of member identity, enrollment, canonical mailbox facts, ordering, and wake handoff.
- Cloudflare remains owner of private hosted object storage and runtime execution; do not create a second canonical store or queue.
- Reuse existing Murph app-session, hosted mailbox, R2/presign, and Temporal handoff primitives where they fit; add no dependency or broad abstraction without a proven gap.
- The upload credential must be opaque or cryptographically verifiable, narrowly scoped to meal-photo upload/self-revocation, associated with one member installation, short-lived/renewable, and safe to persist in the extension keychain; without proof-of-possession it remains a bearer rather than a hardware-bound credential.
- Preserve unrelated worktrees, active ledger rows, and concurrent mailbox/runtime lanes. Avoid overlapping edits unless the existing owner boundary proves they are required.
- Do not launch ReviewGPT until the final exact head is pushed and the recovery controller receives `RECOVERY_REVIEWGPT_READY`.

Key decisions:
- Trace current auth, mailbox, object-storage, and runtime-wake owners before choosing the smallest implementation boundary.
- Treat enrollment and upload as separate authority levels: enrollment uses the foreground Murph session; background upload never receives that session.
- Keep upload validation and idempotency server-owned. The client-provided installation/photo id is an input to a server-scoped dedupe key, not global authority.
- Fail closed when storage publication or canonical mailbox append cannot be proven; do not acknowledge an upload that would strand private content outside the canonical processing path.

State:
- Implementation, latest-main reconciliation, specialist audits, required verification, and parent final review are complete; preparing the scoped commit and PR.

Done:
- Proved the physical-device client reaches the production enrollment route and receives a missing-route failure.
- Shipped the client-side fail-closed setup state, privacy copy, optional onboarding, denied-permission repair, and production configuration checks to the iOS PR branch.
- Reconciled this lane with current `origin/main`, including merged PR #556.
- Proved the smallest auth boundary: foreground Privy identity for enrollment and a dedicated hashed, renewable bearer for background upload/self-revocation.
- Added web-owned enrollment/revocation and bounded JPEG upload routes, encrypted idempotency-secret storage, private Cloudflare staging, a metadata-only hosted mailbox wake, and idempotent canonical meal import with post-checkpoint cleanup.
- Added focused route, validation, wake-contract, encrypted-storage, lifecycle, and canonical-import regression coverage.
- Documented the new architecture, privacy/security boundary, retry/idempotency behavior, and verification limits.
- Passed the focused web, hosted-execution, assistant-runtime, runtime-state, Cloudflare-control, and Cloudflare app tests and typechecks, plus the direct encrypted-stage-to-canonical-import scenario.
- Ran `pnpm verify:acceptance`: all repository guards, workspace typechecks, documentation checks, artifact checks, web build and 4,296-test suite, Cloudflare 1,746-test suite, and changed-package coverage lanes passed. The only failure was the unrelated CLI expansion-intervention file hitting its exact 60-second timeout under parallel coverage; that same file passed 13/13 in 18.74 seconds when rerun in isolation.
- Rebased the isolated task branch onto current `origin/main` (`a78d7638`), preserving the upstream pending-effects parser during the sole conflict, and re-ran the six affected typechecks plus focused suites: web 41, hosted-execution 303, assistant-runtime 8, runtime-state 7, Cloudflare control 43, and Cloudflare app 226 tests all passed.
- Reconciled again after `origin/main` advanced to `259df7dc`, preserving the upstream phone-call/private-content schema and workflow documentation alongside this task's meal-photo additions. The two manual conflicts were limited to the docs index and the hosted migration inventory.
- On `259df7dc`, passed the real hosted-web typecheck, all 27 focused enrollment/upload/JPEG/migration assertions, docs drift, and staged whitespace validation.
- Fast-forwarded once more to `origin/main` at `b6a3a669`; its Pulse Trial changes had no file overlap with this task.
- Repeated the exact-base proof on `b6a3a669`: hosted-web typecheck, all 27 focused enrollment/upload/JPEG/migration assertions, docs drift, and staged whitespace validation passed.
- Fast-forwarded again to `origin/main` at `e00bb0bd`; the browser-vault/session-recovery change set had no file overlap with this task.
- Repeated the exact-base proof on `e00bb0bd`: hosted-web typecheck, all 27 focused enrollment/upload/JPEG/migration assertions, docs drift, and staged whitespace validation passed.
- Fast-forwarded to `origin/main` at `bffe19a9`, preserving its assistant-preference causal ordering and personality schema alongside meal-photo ingestion. Manual conflict resolution was again limited to the docs index and migration inventory; the overlapping hosted-runtime and hosted-execution additions merged additively.
- On `bffe19a9`, passed all six changed-owner typechecks plus focused/full owner suites: web 27, hosted-execution 303, assistant-runtime 8, Cloudflare 226, Cloudflare control 43, and runtime-state 172 tests. Docs drift and staged whitespace validation also passed.
- Ran the current-main `pnpm test:diff` lane across both apps and all four changed packages: all changed-owner and reverse-dependent guards, typechecks, and suites passed except one unrelated setup-wizard TTY assertion under parallel fanout; the exact failing file then passed 6/6 in 13.73 seconds in isolation.
- Ran the required security/privacy audit, accepted and fixed its two concrete findings (renewal/revocation serialization and metadata hidden after a JPEG scan), added barrier-controlled and multi-scan regressions, and completed a clean targeted re-audit with no remaining medium-or-higher finding.
- Ran the required coverage-write audit; it kept production unchanged and strengthened the existing enrollment and JPEG validation tests. Its web verification passed 4,490 tests with 135 skipped.
- Ran final `pnpm verify:acceptance` on `a78d7638`: repository guards, all 28 workspace typechecks, docs/artifact checks, the web production build, every meal-photo owner coverage lane, and the Cloudflare 1,747-test suite passed. The aggregate exit was limited to two unrelated CLI tests exceeding their fixed timeouts under parallel fanout; the intervention file passed 13/13 in 31.83 seconds alone, and the exact release-tarball assertion passed in 105.03 seconds with a 300-second harness window.
- Completed the parent full-diff and changed-call-path review, docs drift, whitespace checks, and identifier/credential scans with no unresolved task finding.

Now:
- Close the plan through `scripts/finish-task`, push the exact scoped head, open the backend PR with the required change-shape and deploy-skew notes, and take its CI to green without launching ReviewGPT early.

Next:
- Report `RECOVERY_REVIEWGPT_READY` with the exact pushed head, wait for controller coordination, then run the required exact-head ReviewGPT loop to zero accepted findings.

Open questions (UNCONFIRMED if needed):
- None. Web-owned bounded ingress stages through the existing internal Cloudflare control client; the hosted mailbox carries only a typed temporary-object reference and integrity metadata.

Working set (files/ids/commands):
- apps/web/app/api/device-sync/companion/**
- apps/web/src/lib/hosted-onboarding/**
- apps/web/src/lib/hosted-mailbox/**
- apps/web/prisma/schema.prisma and an additive migration if durable enrollment/dedupe state is required
- apps/cloudflare/src/** only if an existing private-object control primitive cannot be reused unchanged
- packages/hosted-execution/** only for a demonstrated cross-app public contract
- focused tests adjacent to touched owners
- ARCHITECTURE.md
- agent-docs/SECURITY.md
- agent-docs/RELIABILITY.md
- agent-docs/operations/verification-and-runtime.md
- agent-docs/references/testing-ci-map.md
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
Completed: 2026-07-13
