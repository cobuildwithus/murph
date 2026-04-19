## Title

Remove device-sync runtime snapshot/token re-exports from `@murphai/hosted-execution`.

## Goal

Keep the shared hosted-execution package focused on wake/status/control plumbing by moving device-sync runtime snapshot/token surfaces back behind the device-sync owner package.

## Scope

- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/web/src/lib/device-sync/internal-runtime.ts`
- narrow docs/tests that need to reflect the reduced shared surface

## Constraints

- Preserve the canonical hosted wake flow and avoid touching adjacent in-flight hosted-wake correctness work.
- Keep device-sync wake-hint parsing on the shared wake boundary; only runtime snapshot/token surfaces should move off the shared package.
- Do not broaden into hosted device-sync authority behavior changes.
- Preserve existing package public behavior outside the narrowed exports.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts apps/web/src/lib/device-sync/internal-runtime.ts packages/hosted-execution/README.md agent-docs/references/data-model-seams.md`
- any focused package/app test follow-up if `test:diff` misses the touched owner coverage

## Notes

- The intent is a greenfield hard-cut, not another compatibility shim.
- The shared package should keep device-sync wake-hint vocabulary only where the outer hosted wake contract still needs it.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
