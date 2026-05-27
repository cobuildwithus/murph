# Delete Legacy Ensure Execution

## Goal

Remove the deprecated hosted `ensure-execution` compatibility path while keeping hosted execution on the current `ensure-processing` route.

## Scope

- Delete the Cloudflare `/runtime/ensure-execution` route and Durable Object adapter.
- Delete the Temporal `ensureCloudflareExecution` Activity and workflow fallback branch.
- Delete legacy `HostedRuntimeEnsureExecution*` contracts, parsers, timeouts, and tests.
- Delete legacy runtime-result wake and stale workspace-wake compatibility state.
- Keep current hosted execution, Temporal signaling, device-sync recovery, and `/runtime/ensure-processing`.

## Replay Assumption

The user confirmed the new hosted execution pieces have already been deployed and expects the legacy path to be unnecessary. This change intentionally removes old-history replay compatibility for pre-`ensure-processing` workflow histories; old histories must be drained, continued-as-new, or restarted before deploying this cut.

The active `patched("hosted-user-runtime-ensure-runtime-processing-v1")` marker stays in the workflow for now. Do not switch it to `deprecatePatch()` until histories that already recorded the non-deprecated marker have drained.

## Verification

- Search for legacy symbols after deletion.
- Run focused package/app tests for hosted-execution, hosted-orchestrator-temporal, cloudflare-hosted-control, and Cloudflare hosted routing.
- Run `pnpm typecheck` unless blocked by unrelated dirty-tree failures.
- Run required security/privacy, coverage, and final review audits.

## Status

Implementation complete; live source now uses only `ensure-processing`, with the active Temporal patch marker retained for replay compatibility of histories that already saw it.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
