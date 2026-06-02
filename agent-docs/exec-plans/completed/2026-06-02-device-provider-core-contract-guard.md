Goal (incl. success criteria):
- Add a durable provider-contribution rule and broad regression guard so provider adapters cannot bless canonical event/sample shapes that fail the real core write contract.
- Success means representative default provider fixtures round-trip through `importDeviceProviderSnapshot` and `coreRuntime.importDeviceBatch`, focused importer checks pass, and the scoped task is committed without disturbing unrelated active work.

Constraints/Assumptions:
- Keep the architecture simple: reuse the existing importer-to-core seam and test file rather than adding a new validation framework.
- Preserve unrelated working-tree edits and active lanes.
- Do not expose secrets, direct identifiers, full local paths, or raw private payloads.
- Use small synthetic provider snapshots only.

Key decisions:
- Put the durable rule in `docs/device-provider-contribution-kit.md`, where provider authors already start.
- Put the executable guard in `packages/importers/test/device-providers.test.ts`, because that file already owns shared provider adapter and real-core import coverage.
- Keep provider-specific deep assertions in provider-specific tests; the shared guard only proves default providers produce core-storable canonical records from representative fixtures.
- The new guard found a Strava activity-session contract drift. Keep Strava's canonical event compact and leave provider-specific activity flags/device details in the retained raw activity artifact.

State:
- Active.

Done:
- Read repo routing docs, provider docs, and relevant importer tests.
- Added the provider contribution rule.
- Added the shared default-provider core-contract fixture guard.
- Narrowed Strava activity-session canonical fields to the existing core contract after the guard exposed unsupported top-level fields.
- Fixed security-review doc gap by requiring synthetic/redacted committed provider fixtures.
- Strengthened the Strava real-core fixture to assert supported workout metrics after core validation.
- Verification passed: focused provider test, focused Strava test, importers typecheck, importers coverage, scenario smoke, scoped diff whitespace check.
- Root `pnpm typecheck` and `pnpm test:diff ...` remain blocked by unrelated dirty `scripts/hosted-local-e2e.test.ts` `env` property TypeScript errors before importer coverage runs.

Now:
- Commit the scoped task through `scripts/finish-task`.

Next:
- Handoff with the commit id and verification status.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `docs/device-provider-contribution-kit.md`
- `packages/importers/src/device-providers/strava.ts`
- `packages/importers/test/device-providers.test.ts`
- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers.test.ts`
- `pnpm --dir packages/importers typecheck`
- `pnpm test:diff packages/importers/test/device-providers.test.ts docs/device-provider-contribution-kit.md`
- `pnpm test:smoke`
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
