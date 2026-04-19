# Dedupe hosted-cutover follow-up plans against the current remaining-fixes set

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Make the active hosted-cutover plan set match the current repo state and the still-open final fixes.

## Success criteria

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` stops advertising already-landed hosted-cutover follow-ups as `in_progress`.
- The still-open runner proxy, bundle-ref mutation, helper-level wake scoping, quarantine proof, storage-scope drift, and doc-drift fixes each have one clear active owner.
- Active hosted-cutover plans describe only still-open work, not already-landed queue-owner, schema-owner, or read-path fixes.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-19-hosted-cutover-plan-dedupe-followup.md`
- `agent-docs/exec-plans/active/2026-04-19-hosted-wake-boundary-fixes.md`
- `agent-docs/exec-plans/active/2026-04-19-hosted-runner-surface-hardening.md`

## Constraints

- Keep this as a docs/process-only cleanup pass.
- Preserve unrelated in-flight worktree edits and plan rows outside the hosted-cutover slices being deduped here.
- Use static code/doc inspection plus subagent findings only; do not claim runtime proof that was not run.

## Tasks

1. Reconcile the supplied remaining-fixes list with the current active ledger and completed plan archive.
2. Keep the hosted-wake boundary plan aligned to the still-open wake, storage-scope, and doc/spec follow-ups.
3. Create one active Cloudflare runner hardening plan for the still-open proxy-allowlist and bundle-ref mutation gaps.
4. Remove or replace stale hosted-cutover ledger rows whose work is already landed or now owned elsewhere.

## Decisions

- Keep the active hosted-cutover set small: one wake-boundary plan, one Cloudflare post-CAS/parser plan, one runner-surface hardening plan, plus any still-live adjacent package-only wake cleanup.
- Treat the broad runner web-control proxy and fail-open bundle-ref mutation path as one Cloudflare runner hardening lane because they share the same trust-boundary and write set.
- Fold storage-scope and architecture/readme drift into the wake-boundary cutover-truth plan instead of opening a separate docs-only runtime plan.

## Findings

- GPT-5.4 high explorer review confirmed the still-open runtime seams are: broad `web-control.worker` forwarding, optional helper-level hosted-wake owner scoping, and fail-open bundle-ref mutation/CAS handling.
- GPT-5.4 high explorer review confirmed the still-open doc/storage seams are: stale execution-journal wording in `ARCHITECTURE.md` / `docs/architecture.md`, the missing webhook-receipts cron route in `apps/web/README.md`, and stale hosted cipher scopes in `packages/runtime-state/src/hosted-storage.ts`.
- The deploy-boolean parsing cleanup is already archived under `agent-docs/exec-plans/completed/2026-04-19-cloudflare-deploy-boolean-env-parsing.md`.
- The runner-outbound codec cleanup is already reflected in live code and should no longer remain an `in_progress` ledger row.
- The earlier bundle-ref fail-closed plan only covered the read path and is archived under `agent-docs/exec-plans/completed/2026-04-19-runner-bundle-ref-fail-closed.md`; the remaining mutation/CAS gap needs a new active owner.

## Verification

- `git diff -- agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-19-hosted-cutover-plan-dedupe-followup.md agent-docs/exec-plans/active/2026-04-19-hosted-wake-boundary-fixes.md agent-docs/exec-plans/active/2026-04-19-hosted-runner-surface-hardening.md`
- `pnpm verify:acceptance`
Completed: 2026-04-19
