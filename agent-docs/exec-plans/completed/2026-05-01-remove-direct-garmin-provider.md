# Remove Direct Garmin Device-Sync Provider

## Goal

Remove Garmin as a bespoke configured device-sync provider, including direct `GARMIN_*` credential/env support and direct OAuth provider wiring, while keeping Garmin connect available through Junction when Junction supports it.

## Scope

- Remove direct Garmin provider runtime wiring from `packages/device-syncd`.
- Update connect-target resolution so Garmin can resolve to Junction via `sourceProviderSlug: "garmin"`.
- Remove direct Garmin setup/CLI/env/deploy guidance and tests.
- Preserve legacy Garmin importer/query support unless a direct provider dependency requires narrowing.

## Verification

- Focused device-syncd, hosted web, Cloudflare, importer, operator-config, setup-cli, CLI, and assistant-runtime tests passed.
- Package/app typechecks passed for device-syncd, importers, operator-config, setup-cli, assistant-runtime, apps/web, and apps/cloudflare.
- Root `pnpm typecheck`, `test:diff`, `packages/cli typecheck`, and CLI schema generation are blocked by unrelated active assistant-engine/assistant-cli event-type churn.

## Notes

- Preserve active Junction edits in overlapping provider config files.
- Do not remove Junction's Garmin source support.
- Commit is blocked by overlapping active dirty work in shared Junction/provider files; do not stage whole overlapping files.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
