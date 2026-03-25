# 2026-03-25 Host Linux Support

## Goal

Land the supplied host-support patch onto the current tree so Healthy Bob onboarding/setup works on Linux without regressing macOS setup or mixed-host vault behavior.

## Scope

- Add repo-local host wrappers for macOS and Linux setup entrypoints.
- Extend CLI setup services and wizard defaults to support `darwin` and `linux`.
- Keep iMessage explicitly macOS-only while allowing Linux inbox runtime/setup flows to continue with supported connectors.
- Update docs/tests/CI coverage for the supported host matrix.

## Constraints

- Preserve adjacent in-flight CLI/setup edits already present in the worktree.
- Do not silently disable existing macOS-only iMessage state when Linux setup runs against a shared vault.
- Keep Linux failures actionable when required host tools cannot be auto-provisioned.
- Required verification remains `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, plus completion audits for production/test changes.

## Planned Files

- `.github/workflows/host-support.yml`
- `README.md`
- `package.json`
- `scripts/setup-host.sh`
- `scripts/setup-linux.sh`
- `packages/cli/src/inbox-app/{runtime.ts,sources.ts,types.ts}`
- `packages/cli/src/{run-terminal-logging.ts,setup-cli.ts,setup-cli-contracts.ts,setup-runtime-env.ts,setup-services.ts,setup-wizard.ts}`
- `packages/cli/src/setup-services/{channels.ts,toolchain.ts}`
- `packages/cli/test/{inbox-cli.test.ts,setup-cli.test.ts}`
- Runtime/docs files required to keep architecture and verification guidance truthful

## Verification Plan

1. Merge the patch against current drift and regenerate any required executable bits.
2. Run targeted CLI tests for setup/inbox host behavior.
3. Run required repo checks.
4. Run completion workflow audit passes.
5. Commit only touched files with `scripts/committer`.
