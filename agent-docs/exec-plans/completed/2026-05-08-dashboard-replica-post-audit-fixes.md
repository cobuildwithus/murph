# Dashboard replica post-audit fixes

## Goal

Land the actionable post-audit fixes from the five-agent review while preserving the simplified dashboard-replica ownership boundary and public browser-vault compatibility.

## Success criteria

- Keep Worker/DO deploy skew safe by supporting both old and new internal refresh RPC names for one compatibility window.
- Ensure foreground runner invocations preempt optional detached dashboard refresh work before acquiring/publishing foreground work.
- Add a durable pending-refresh backstop alarm even when a detached refresh starts immediately.
- Remove unneeded wrappers/aliases that do not buy compatibility.
- Keep browser-vault concrete artifact/session/control-route names where they are compatibility surfaces.

## Constraints

- Preserve unrelated dirty files.
- Avoid expanding the dashboard refresher abstraction just to move publish/classification out of runner-owned foreground/preemption checks.
- Keep changes small and covered by focused tests.

## Verification plan

- Focused Cloudflare runner/index tests.
- Focused web browser-vault session route test.
- `pnpm typecheck`.
- `git diff --check`.

## Status

- Restored deploy-skew-safe Durable Object refresh RPC compatibility.
- Added foreground preemption and a pending-refresh backstop alarm for detached dashboard replica refreshes.
- Renamed the internal runtime-platform refresh source-hash field to dashboard-replica terminology.
- Removed the unused web refresh-client wrapper module and state-store browser-vault alias methods.
- Focused Cloudflare tests, focused web session test, `pnpm typecheck`, and `git diff --check` passed.
- `test:diff` passed the Cloudflare lane and failed in broader apps/web billing/account-settings/biomarker tests outside this change.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
