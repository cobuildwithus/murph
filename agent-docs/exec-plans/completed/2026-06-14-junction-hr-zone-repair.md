Goal (incl. success criteria):
- Fix Junction workout `hr_zones` normalization so documented numeric arrays store six buckets as zones `0..5` instead of misleading `1..6`.
- Add an explicit, idempotent repair command for existing Junction/Garmin workout records already stored with the old `1..6` mapping.
- Success means future imports normalize correctly, dry-run/apply repair surfaces exact counts, apply writes append-only event revisions through core, and focused tests prove importer, repair, and CLI behavior.

Constraints/Assumptions:
- Junction docs define workout `hr_zones` as an ordered numeric duration array for buckets `<50%`, `50-60%`, `60-70%`, `70-80%`, `80-90%`, and `90%+`.
- Do not add a silent startup/read migration; canonical health-data repair must be named, explicit, audited, and idempotent.
- Preserve explicit object-shaped provider zones where available.
- Avoid touching the active Junction provider work in the main checkout.

Key decisions:
- Map numeric entries from Junction `hr_zones` by array index, including sparse arrays.
- Put existing-data cleanup behind a narrow core-owned repair primitive plus CLI command requiring explicit `--apply`.
- Keep the repair intentionally conservative: only Garmin/Junction workout records whose `heartRateZones` are exactly duration-only `1..6` and whose raw Junction evidence contains a primitive numeric zone array are repair candidates. Suspicious rows without that proof are counted as unverified and skipped.

State:
- Complete; scoped commit created and raw-evidence PR review fix applied.

Done:
- Verified current code maps numeric array entries via fallback `index + 1`.
- Verified Junction API docs describe `hr_zones` as a numeric duration array, not provider zone objects.
- Patched Junction numeric workout zone normalization to use array indexes `0..5`.
- Added an explicit, dry-run-by-default `vault repair-junction-hr-zones` command backed by a core append-only repair primitive.
- Added importer, core repair, CLI, runtime-shape, and audit-boundary coverage.
- Added re-import regression proof so repaired `0..5` records are not rewritten when Junction re-syncs the same workout.
- Applied PR review fixes: sparse numeric arrays now map by element index, and repair apply now requires matching raw primitive numeric-array evidence before mutating.
- Ran focused package tests, root typecheck, `pnpm test:diff ...`, and `pnpm test:smoke`.
- Ran required `security-privacy-review`, `coverage-write`, `deep-review`, and PR review round 1; no unresolved accepted/actionable findings remain.

Now:
- Rerun routed diff verification, amend scoped commit, and push PR review fixes.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/importers/src/device-providers/junction.ts
- packages/importers/test/device-providers-junction.test.ts
- packages/core/src/junction-hr-zone-repair.ts
- packages/core/src/index.ts
- packages/core/src/public-mutations.ts
- packages/core/test/audit-boundary.test.ts
- packages/core/test/device-import.test.ts
- packages/cli/src/commands/vault.ts
- packages/cli/src/incur.generated.ts
- packages/cli/src/vault-cli-command-manifest.ts
- packages/cli/test/*
- packages/vault-usecases/src/usecases/integrated-services.ts
- packages/vault-usecases/src/usecases/runtime.ts
- packages/vault-usecases/src/usecases/types.ts
- packages/vault-usecases/src/vault-services.ts
- packages/vault-usecases/test/runtime.test.ts
- docs/contracts/03-command-surface.md
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
