## Title

Make hosted device-sync disconnects clear mirrored provider tokens deterministically.

## Goal

Close the hosted device-sync seam where a trusted runtime disconnect update can persist `connection.status = "disconnected"` in web while leaving the mirrored encrypted token bundle unchanged.

## Scope

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `apps/web/src/lib/device-sync/prisma-store/connections.ts`
- focused hosted device-sync tests under `packages/assistant-runtime/test/**` and `apps/web/test/**`

## Constraints

- Preserve the current signed runtime-callback flow and trust boundaries.
- Keep the change narrow: disconnect must imply token clearing without broadening adjacent hosted device-sync semantics.
- Do not retain provider access or refresh tokens after a disconnected update is accepted.
- Preserve unrelated dirty-tree edits and nearby in-flight hosted device-sync work.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test apps/web/src/lib/device-sync/hosted-runtime-authority.ts apps/web/src/lib/device-sync/prisma-store/connections.ts apps/web/test`
- planned: focused Vitest proofs for the runtime builder and hosted web apply path if the diff-aware lane is noisy

## Notes

- Required proof includes a runtime disconnect update that omits `tokenBundle` and still clears stored mirrored tokens on the web side.
- Required proof also includes a runtime-builder regression showing disconnected local accounts emit `tokenBundle: null`.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
