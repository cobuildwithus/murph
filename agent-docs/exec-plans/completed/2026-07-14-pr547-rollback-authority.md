Goal (incl. success criteria):
- Close PR #547's rollback authority-confusion gap without adding schema or compatibility machinery.
- Success means a newly issued Messages-only bearer is stored under a scope-tagged lookup hash that the historical unscoped device-agent reader cannot resolve, current Messages proof/revocation still work, required verification and specialist audits pass, the scoped follow-up is committed and pushed, and exact-head ReviewGPT starts concurrently with CI.

Constraints/Assumptions:
- Preserve the existing 24-hour random `hbds_imessage_` bearer, hash-only persistence, active-access and launch-consent proof gates, and authenticated self-revocation behavior.
- Preserve device-agent `hbds_agent_` prefix enforcement; do not add a new table, schema field, migration reader, queue, or persisted compatibility state.
- PR #547 is still unmerged, so there is no production Messages credential population requiring a legacy unscoped read path. Fail closed for any branch-era unscoped Messages rows.
- Keep the capability-less message URL and host-app-only Privy boundary unchanged.
- Physical-device Keychain and installed Messages-extension acceptance remains an explicit deployment/device proof gap.
- Do not touch PR #542; PR #573 remains out of scope.

State:
- Completed locally: the rollback authority gap is closed on current `main`, required audits and focused proof are clean, and the PR's external ReviewGPT/CI gates remain.

Done:
- Reconfirmed the isolated PR worktree is clean at pushed head `282ed740ad3ee6980d2348388d0c32ecbd62f112`.
- Read the repository workflow, architecture, security, verification, testing, completion-audit, active-ledger, and prior completed-plan guidance.
- Proved the exact path: Messages enrollment stores `sha256(raw bearer)` in the shared `device_agent_session.token_hash`; the historical device-agent reader before the PR-specific prefix check hashes any bearer identically and queries that unique hash, so rolling back the reader can reinterpret a Messages credential as device-agent authority.
- Domain-separated both Messages credential persistence and lookup at the Messages service owner, with no schema, migration, fallback read, or additional state owner.
- Added direct regression proof that a newly issued Messages bearer is unreachable to the historical unscoped device-agent reader, current Messages proof still succeeds, and a branch-era raw-hash row fails closed.
- Reconciled current `origin/main` through `b2f6cd0957d8a85a9fa7c38fde88d63bdac6ad4e`; the only conflict preserved the newer exercise-lane ledger row plus this task's active row.
- Ran focused Messages service and route proof after the final base merge: 2 files and 15/15 tests passed.
- Ran the truthful `pnpm test:diff` lane: repository guards, lint with zero errors, the production Next build, type validation, and 4,964 web tests passed; one adjacent suite import and the prepared dev smoke timed out under concurrent host load. Both were rerun independently and passed: agent-session routes 11/11 and the exact prepared dev-smoke command exited zero.
- Ran required `security-privacy-review`: zero Critical, High, or Medium findings across hash storage/authentication, prefix rejection, legacy-reader isolation, revocation binding, and leakage checks.
- Ran required `coverage-write`: added the branch-era raw-hash fail-closed regression; focused proof remained 15/15 afterward.
- Completed parent final review of enrollment, scoped lookup, current and historical device-agent readers, proof, revocation, tests, docs, and final diff with no unresolved actionable findings.

Now:
- Close the plan in the scoped final commit, push the exact head, update the PR intent/change-shape contract, and start exact-head ReviewGPT concurrently with CI.

Next:
- Resolve only locally proven ReviewGPT or CI findings and stop when the PR is merge-ready. Do not merge.

Working set (files/ids/commands):
- PR #547 / `codex/imessage-mini-app`
- `apps/web/src/lib/imessage-mini-app/service.ts`
- `apps/web/test/imessage-mini-app-service.test.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- focused Vitest for the Messages mini-app service and route tests
- `pnpm test:diff <touched paths>`

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
Completed: 2026-07-14
