# Hosted Runner Target-Area Review Follow-Up

## Goal

Land the still-missing behavior-preserving follow-up from the supplied hosted-runner target-area review patch, limited to the runner env/runtime seam.

## Why

- `apps/cloudflare/src/node-runner.ts` still rebuilds child forwarded env from ambient container env even when the worker already supplied a typed runtime envelope.
- `apps/cloudflare/src/runner-env.ts` still keeps a stale split between timeout and allowed-user-env config sources even though the live caller reads both from the same source.

## Scope

- `apps/cloudflare/src/{node-runner.ts,runner-env.ts,user-runner/runner-dispatch-processor.ts}`
- focused regression coverage in `apps/cloudflare/test/{node-runner.test.ts,runner-env.test.ts}`

## Constraints

- Preserve unrelated dirty-tree work, especially active Cloudflare, assistant, and hosted-web edits outside this seam.
- Treat the supplied patch as behavioral intent, not overwrite authority; adapt only where current HEAD differs.
- Keep the change scoped to authoritative worker-owned runtime config, child env stripping, and the shared config-source simplification.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Verification

- Run `pnpm typecheck`.
- Run a truthful scoped lane for the touched Cloudflare owner, preferring `pnpm test:diff` when it truthfully covers only this task slice.
- Add direct proof through focused hosted-runner tests that worker-supplied forwarded env stays authoritative and that the shared config source still owns timeout plus user-env filtering.
- Record unrelated blockers exactly if they appear.

## Result

Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
