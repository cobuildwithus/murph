Goal (incl. success criteria):
- Harden device-sync provider registration so descriptor-declared connection and credential capabilities fail fast when the provider implementation cannot satisfy them.
- Keep the existing OAuth compatibility adapter path valid while requiring `external_link` providers to expose the generic connection handler shape.
- Add focused tests for invalid provider registration and keep the change scoped away from active Junction/provider config work.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Avoid touching active provider factory/manifest files unless the registry boundary cannot cover the invariant cleanly.
- Do not introduce new persisted state or dependencies.

Key decisions:
- Put validation at the device-sync registry boundary so configured and test-created providers are checked before runtime ingress/job paths use them.

State:
- Implemented; scoped commit blocked by unrelated overlapping dirty coordination ledger and active Garmin removal work.

Done:
- Reviewed current provider type, public ingress, credential policy, and refresh paths.
- Added registry-time provider capability validation.
- Added focused provider capability tests.
- Updated external-link public-ingress fixtures to expose inert `completeConnection()` stubs where they only exercised `beginConnection()`.
- Verification: `pnpm --dir packages/device-syncd typecheck` passed; `pnpm test:smoke` passed; direct `tsx` registry scenarios for external-link and OAuth refresh support passed; `git diff --check` passed.

Now:
- Closing plan and handing off uncommitted due overlapping dirty tree.

Next:
- Re-run Vitest once the active Garmin provider-removal row resolves the package export/source mismatch for `providers/garmin`.

Open questions (UNCONFIRMED if needed):
- Focused Vitest is blocked by unrelated active Garmin removal: package test config cannot resolve `./dist/providers/garmin.js` to a source file while `packages/device-syncd/src/providers/garmin.ts` is deleted.

Working set (files/ids/commands):
- `packages/device-syncd/src/registry.ts`
- `packages/device-syncd/test/provider-capability-validation.test.ts`
- `packages/device-syncd/test/public-ingress.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
