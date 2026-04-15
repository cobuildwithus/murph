# Goal (incl. success criteria):
- Land the supplied hosted device-sync local-heartbeat target-area patch without disturbing unrelated in-flight work.
- Success means the hosted local-heartbeat route uses one owned patch shape end-to-end, the Prisma store forwards the exact validated heartbeat update shape downstream, dead parser alias re-exports are removed, and focused regression coverage proves the narrowed contract.

# Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially concurrent `packages/messaging-ingress/**` changes and overlapping hosted device-sync lanes.
- Keep the landing narrow to the supplied patch intent plus any verification- or review-driven fixes needed on current `HEAD`.
- Treat the local-heartbeat route as a hosted operational boundary: fail closed on empty or server-owned payloads and keep secret-bearing fields redacted.
- Assumption: no external caller still depends on the removed `parseHostedDeviceSyncRuntime{Apply,Snapshot}Request` aliases from `apps/web/src/lib/device-sync/internal-runtime.ts`.

# Key decisions:
- Reuse `HostedLocalHeartbeatPatch` as the single client-owned local-heartbeat shape across control-plane, agent-session, and Prisma store seams.
- Forward the exact validated local-state update that the heartbeat helper builds, instead of rebuilding a broader runtime payload in the Prisma store.
- Move parser-ownership assertions to `packages/device-syncd` tests and update hosted-web tests to import the parser from its owning package where needed.

# State:
- in_progress

# Done:
- Read the repo routing, completion, verification, testing, and security docs.
- Inspected the supplied patch and reconciled it against the current tree, including existing hosted-web parser-compatibility tests.
- Registered this narrow landing lane in the coordination ledger.
- Landed the local-heartbeat patch-shape changes across the hosted-web control-plane seam and removed the dead hosted-web parser alias re-export.
- Realigned hosted-web tests to the package-owned runtime parser, deleted the dead alias-compatibility test, and added focused local-heartbeat regression coverage.
- Passed scoped verification on `pnpm --dir packages/device-syncd typecheck`, focused `packages/device-syncd` Vitest, focused `apps/web` Vitest for the touched files, direct `tsx` heartbeat proof, and `git diff --check`.
- Ran the required final completion review; it found no issues in this narrowed landing.

# Now:
- Close the plan and commit the landed paths with the repo helper.

# Next:
- Resolve any final-review findings if needed, close the plan, and hand off with the scoped-verification note about unrelated hosted-web typecheck blockers.

# Open questions (UNCONFIRMED if needed):
- `pnpm typecheck` remains blocked by unrelated pre-existing `apps/web/test/hosted-execution-outbox.test.ts` and `apps/web/test/hosted-onboarding-webhook-receipt-codec.test.ts` JSON typing errors.

# Working set (files/ids/commands):
- Files: this plan, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/web/src/lib/device-sync/{control-plane.ts,internal-runtime.ts,local-heartbeat.ts,prisma-store.ts,prisma-store/types.ts}`, `apps/web/test/{device-sync/local-heartbeat.test.ts,device-sync-internal-runtime.test.ts,hosted-contact-privacy.test.ts}`, `packages/device-syncd/test/hosted-runtime.test.ts`
- Commands: `pnpm typecheck` (known unrelated hosted-web failures), `pnpm --dir packages/device-syncd typecheck`, focused `vitest run` commands for `apps/web` and `packages/device-syncd`, direct `pnpm exec tsx --eval ...` heartbeat proof, required audit helper, commit helper
- Patch source: supplied hosted device-sync target-area patch
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
