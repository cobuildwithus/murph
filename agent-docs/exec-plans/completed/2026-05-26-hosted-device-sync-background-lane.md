# Hosted Device Sync Background Lane

## Goal

Land the next safe slice of the hosted device-sync foreground/background migration without adding a new queue, snapshot store, or standalone sync plane.

Success criteria:

- cold-start hosted mailbox import is explicitly foreground-first where safe
- legacy/background device-sync work remains preemptible and non-blocking for fresh conversation input
- webhook dirty-state handling is moved away from foreground mailbox work only if it can be done cleanly without unsafe overlap
- tests document the chosen contracts

## Constraints

- Keep architecture simple and reuse existing hosted runtime, dirty-state, and wake primitives.
- Preserve legacy `device-sync.wake` compatibility until old rows and recovery producers are safely handled.
- Do not create a new queue table or snapshot/read-model store.
- Do not inspect, print, fixture, or commit raw provider payloads, raw health data, secrets, local paths, or direct user identifiers.
- Preserve unrelated dirty work in `apps/web/test/device-sync-hosted-wake.test.ts`, `packages/device-syncd/test/public-ingress.test.ts`, and `packages/device-syncd/test/service.test.ts`.

## Plan

1. Inspect hosted mailbox import, device-sync wake, and webhook dirty-state seams.
2. Land foreground-first import and/or legacy-yield hardening if local and safe.
3. Evaluate whether webhook acceptance can stop producing foreground mailbox work without unsafe overlap; land only if clean.
4. Run focused tests, typecheck, and required audits.
5. Close the plan and commit scoped changes.

## Verification

- Focused hosted-execution parser tests passed.
- Focused hosted-orchestrator Temporal workflow/activity tests passed.
- Focused assistant-runtime assistant-phase tests passed.
- Focused Cloudflare ensure-processing runner tests passed.
- Focused web background-maintenance signal tests passed.
- `git diff --check` passed.
- `pnpm docs:drift` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed after final review fixes.
- `security-privacy-review` passed with no findings.
- `simplify` found two low-complexity issues; both were fixed.
- `coverage-write` added assistant-runtime child job parser proof and reran `pnpm test:diff`.
- `task-finish-review` found a foreground deploy-skew issue; it was fixed and reverified.

## State

Complete. The hosted foreground runtime imports conversation mailbox work first, direct dirty webhook transitions use dirty state plus a best-effort background-maintenance Temporal signal instead of appending new `device-sync.wake` mailbox work, and `device_sync_recovery` is preserved through Temporal ensure-processing, Cloudflare runner invocation, and assistant-runtime parsing only for the background recovery demand that needs it. The assistant phase runs dirty device-sync only when no fresh conversation input is pending and schedules a short `device-sync.reconcile` retry when foreground work preempts recovery. Legacy `device-sync.wake` remains as bounded compatibility/recovery, not the direct webhook hot path.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
