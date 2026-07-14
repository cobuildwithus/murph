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
- Active implementation follow-up after a completed read-only reconciliation triage found a high-severity rollback authority issue.

Done:
- Reconfirmed the isolated PR worktree is clean at pushed head `282ed740ad3ee6980d2348388d0c32ecbd62f112`.
- Read the repository workflow, architecture, security, verification, testing, completion-audit, active-ledger, and prior completed-plan guidance.
- Proved the exact path: Messages enrollment stores `sha256(raw bearer)` in the shared `device_agent_session.token_hash`; the historical device-agent reader before the PR-specific prefix check hashes any bearer identically and queries that unique hash, so rolling back the reader can reinterpret a Messages credential as device-agent authority.

Now:
- Domain-separate the Messages lookup hash at its service owner and add direct legacy-reader rollback regression proof.

Next:
- Run focused tests and the truthful apps/web diff lane.
- Run required security/privacy and coverage-write passes, resolve accepted findings, and complete the parent final review.
- Reconcile current `main`, close this plan with `scripts/finish-task`, push the exact head, update the PR description if needed, and start ReviewGPT concurrently with CI. Do not merge.

Working set (files/ids/commands):
- PR #547 / `codex/imessage-mini-app`
- `apps/web/src/lib/imessage-mini-app/service.ts`
- `apps/web/test/imessage-mini-app-service.test.ts`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- focused Vitest for the Messages mini-app service and route tests
- `pnpm test:diff <touched paths>`

Status: active
Updated: 2026-07-14
