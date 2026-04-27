# Cloudflare Old Run-Control Delete

## Goal

Delete the old Cloudflare hosted-run/run-drain control-plane modules and stale tests now that the user runner is moving to workspace runtime.

## Scope

- Owned Cloudflare files:
  - `apps/cloudflare/src/user-runner/run-finalization.ts`
  - `apps/cloudflare/src/user-runner/runner-run-processor.ts`
  - `apps/cloudflare/src/user-runner/runner-web-observability.ts`
  - `apps/cloudflare/src/user-runner/wake-inputs.ts`
  - `apps/cloudflare/src/web-control-plane.ts`
  - `apps/cloudflare/test/runner-run-processor.test.ts`
  - `apps/cloudflare/test/web-control-plane.test.ts`
  - `apps/cloudflare/test/helpers/hosted-local-test-worker-fixture.ts`
- Any direct stale Cloudflare tests that only covered acquire/commit/finalize/release/status/log.

## Constraints

- Do not touch runner-container/transport, web email ingress, or assistant-runtime.
- Do not reintroduce acquire/commit/finalize/peek/adopt/release/status logic in Cloudflare.
- Keep hosted-runtime log/status paths only where `runtime-platform` uses the new hosted-runtime web control.
- Preserve unrelated concurrent work.

## State

- Deleted the old Cloudflare hosted-run/run-drain modules and stale direct tests.
- Kept `apps/cloudflare/src/web-control-plane.ts` only as the generic signed hosted-web callback fetch helper used by the workspace runtime paths.
- Removed stale duplicate-commit local E2E workflow/script coverage and updated the matching guard/docs/prompt references.
- Residue scans for old acquire/commit/finalize/release/status/log/turn-input helpers and routes are clean in `apps/cloudflare/src` and `apps/cloudflare/test`.
- Focused tests and full `apps/cloudflare` typecheck pass.

## Verification Plan

- Run `rg` residue checks for production imports and old run-control verbs in Cloudflare.
- Run focused Cloudflare typecheck/tests if feasible.
