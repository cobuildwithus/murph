## Goal

Land the supplied hosted-wake follow-up cleanup patch without reintroducing stale pre-cutover behavior, keeping only the hunks that are still needed on top of the current tree.

## Scope

- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `apps/web/src/lib/hosted-wake/**`
- `apps/web/test/**`
- hosted wake durability docs only if the final implementation changes the current architecture contract

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority.
- Preserve the current thin-shim cutover direction where web owns wake ordering, lifecycle, and cursor correctness.
- Do not revert or overwrite unrelated hosted wake work already present in the tree.
- Keep the patch narrow: only land hunks that still fix live correctness or remove still-dead compatibility surface.

## Verification

- `pnpm typecheck`
- truthful scoped coverage or diff-aware verification for touched `apps/cloudflare`, `apps/web`, and any touched shared owners
- required completion audits per repo workflow before commit
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
