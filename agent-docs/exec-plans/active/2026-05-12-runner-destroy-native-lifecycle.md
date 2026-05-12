# Runner Destroy Native Lifecycle

## Goal

Simplify `RunnerContainer` destroy cleanup to rely on Cloudflare Containers' native `destroy()` completion semantics instead of custom post-destroy status polling.

## Scope

- `apps/cloudflare/src/runner-container.ts`
- Focused `RunnerContainer` lifecycle tests.

## Constraints

- Preserve fail-closed behavior for explicit cleanup when `destroy()` itself fails.
- Preserve fail-open best-effort behavior for idle/activity cleanup.
- Preserve missing-container handling as already destroyed.
- Do not touch unrelated hosted runner work currently registered in the coordination ledger.

## Verification

- Focused `runner-container` tests.
- `pnpm --dir apps/cloudflare typecheck`.
- `pnpm --dir apps/cloudflare verify` if focused checks pass.
