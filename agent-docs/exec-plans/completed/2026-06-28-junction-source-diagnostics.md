Goal (incl. success criteria):
- Generalize the admin Junction diagnostics UI/API from Garmin-only to an explicitly selected Junction source provider.
- Success means an allowlisted ops admin can enter any Junction source provider slug, run the same safe matrix diagnostic for a target member, and receive only metadata/count summaries.

Constraints/Assumptions:
- Keep the existing shared diagnostic runner and redaction behavior.
- Do not introduce a provider registry, discovery surface, or persisted state for this follow-up.
- Keep the diagnostic feature flag enforced outside localhost.
- Preserve existing member-scoped settings diagnostics behavior.
- Keep the ops UI operational and dense.

Key decisions:
- Keep a single explicit `sourceProvider` admin input instead of adding provider discovery or a registry dependency.
- Rename the new admin ops endpoint from Garmin-specific to Junction-specific while PR 338 is still draft, preserving the existing member-scoped settings diagnostics route.

State:
- Implementation complete; verification passed; ready for scoped commit.

Done:
- Read current coordination ledger and relevant workflow/device-sync/frontend docs.
- Generalized the ops route/service/types/UI to accept a selected Junction source provider.
- Updated the hosted ops diagnostic test to use a non-Garmin source provider and added missing-source validation coverage.
- Verified with web typecheck, focused diagnostic route tests, `pnpm test:diff`, `git diff --check`, and a privacy string scan.

Now:
- Commit and push the finished follow-up to PR 338.

Next:
- Update the existing PR body for the generic Junction-source endpoint and note the required deployment env flag.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/ops/runtime-maintenance/runtime-maintenance-client.tsx
- apps/web/app/api/ops/device-sync/junction-diagnostics/route.ts
- apps/web/src/lib/hosted-ops/device-sync-diagnostic-types.ts
- apps/web/src/lib/hosted-ops/device-sync-diagnostics.ts
- apps/web/test/hosted-ops-device-sync-diagnostics.test.ts
Status: completed
Updated: 2026-06-28
Completed: 2026-06-28
