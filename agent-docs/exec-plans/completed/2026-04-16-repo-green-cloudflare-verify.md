## Goal (incl. success criteria):

- Get the repo back to a truthful green verification state.
- Success means `pnpm --dir apps/cloudflare verify` exits cleanly, the full repo acceptance lane is green, and only the exact required files are committed.

## Constraints/Assumptions:

- Preserve unrelated worktree edits.
- Keep fixes minimal and verification-driven.
- Do not add hacky production logic just to satisfy local or CI harness behavior.

## Key decisions:

- Treat the remaining Cloudflare issue as an exit/open-handle problem until proven otherwise.
- Prefer test and harness fixes over runtime changes unless a failing verification proves runtime behavior is wrong.

## State:

- in_progress

## Done:

- Confirmed previously failing Cloudflare expectations in `user-env`, `node-runner-abort`, `smoke-hosted-deploy`, `index-backpressure`, `index`, and `node-runner` were updated and pass in targeted runs.
- Confirmed the remaining blocker is the full `apps/cloudflare` node test lane not exiting cleanly.

## Now:

- Isolate the exact suite or shared handle that keeps the full Cloudflare node run alive.

## Next:

- Patch the narrow teardown or expectation issue.
- Rerun Cloudflare verify, then full repo acceptance.
- Run required completion audits and commit the exact touched files.

## Open questions (UNCONFIRMED if needed):

- UNCONFIRMED: which exact suite combination or shared resource leaves the full runner project alive when the split subgroup runs both exit cleanly.

## Working set (files/ids/commands):

- `apps/cloudflare/test/**`
- `apps/cloudflare/scripts/verify-fast.sh`
- `pnpm --dir apps/cloudflare verify`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner --no-coverage`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
