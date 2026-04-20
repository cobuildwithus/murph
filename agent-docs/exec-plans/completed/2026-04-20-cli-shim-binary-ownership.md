## Title

Make the published CLI package own the setup shim binary path so `murph` / `vault-cli` shims target the real built entrypoint.

## Goal

Remove the stale default path assumption from `packages/setup-cli` and thread the built CLI binary path explicitly from `packages/cli`, while adding regression coverage for the real non-injected path.

## Scope

- `packages/cli/src/cli-entry.ts`
- `packages/setup-cli/src/setup-cli.ts`
- `packages/setup-cli/src/setup-services.ts`
- focused setup/CLI tests under `packages/{cli,setup-cli}/test/**`

## Constraints

- Keep binary-path ownership in `packages/cli`; `packages/setup-cli` should stay a reusable library that accepts an explicit path.
- Do not broaden into fallback-to-source shim behavior.
- Preserve the hosted Cloudflare runtime contract, which consumes the installed `vault-cli` binary and does not run setup.
- Avoid unrelated CLI surface or onboarding behavior changes.

## Verification

- `pnpm typecheck`
- truthful focused package coverage or `pnpm test:diff` for the touched setup/CLI owners

## Notes

- The current regression came from copying a sibling-`bin.js` resolver into `packages/setup-cli` during the package split, which changed the meaning of the default path from `packages/cli/dist/bin.js` to `packages/setup-cli/dist/bin.js`.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
