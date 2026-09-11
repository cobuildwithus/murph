# Align the Environment fixture with independent mailbox ownership

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Make the foreground-priority fixture hold the current independent system-mailbox
checkpoint while proving the earlier default-owned row stays pending and no
extra assistant-provider request occurs.

## Scope and constraints

- Change the case name, expected owner, and held-prefix assertion only.
- Correct the current testing owner and index; reuse Frog #2724.
- Preserve runtime scheduling, snapshot deadlines, replica checks, and cleanup.
- No local production actions, full hosted E2E, push, or PR mutation in this handoff.

## Cause and decisions

Web reconciliation selects eligible independent model-free work even behind a
default-owned row. The old fixture instead waits for a default invocation while
the actual system-mailbox invocation holds snapshot start. Current owner tests
prove selection does not advance handled progress and Environment does not enter
the assistant phase. The existing snapshot barrier and ownership helper suffice.

## Tasks

1. Completed: reconciled current main and applied the three fixture corrections.
2. Completed: updated the current testing description, index, and matching friction entry.
3. Completed: the two focused owner tests, Cloudflare typecheck, docs and complexity checks passed.
4. Completed: reviewed privacy, invariant preservation and the complete diff; handoff is a scoped local commit.

## Verification

- `pnpm --dir apps/web test:prepared test/hosted-orchestration-reconciliation-facts.test.ts -t 'exposes independent model-free work behind an assistant item without advancing handled progress'`: passed 1 selected case; 70 unselected.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'system mailbox mode applies Environment answers without a model and refreshes the browser replica'`: passed 1 selected case; 65 unselected.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm docs:drift`: passed; `pnpm docs:gardening`: passed with zero issues.
- `pnpm complexity:diff`: passed; no production JS/TS change to measure.
- `git diff --check` and added-text privacy review: passed.
- Diff review: unchanged replica and provider-count assertions remain; the held-prefix assertion now also excludes consuming the earlier default-owned row. No runtime branch, timeout, helper or abstraction was added.
- Managed release admission owns composed hosted-local E2E proof after integration.
- Changelog is not applicable: internal test expectations and documentation only.
Completed: 2026-09-10
