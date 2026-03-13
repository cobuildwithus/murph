# CLI helper-module split plan

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

Goal (incl. success criteria):
- Break the kitchen-sink CLI helper files into smaller modules organized by noun or capability so new commands do not accumulate in unrelated grab-bags.
- Reuse one shared `inputFileOptionSchema`, remove or centralize ad hoc multi-value parsing, collapse `journal link-*` and `unlink-*` into typed `journal link` and `journal unlink`, and make `audit tail` an alias of descending `audit list` semantics unless a real divergence is required.
- Success means the affected command modules import narrower helpers, current behavior stays covered by CLI tests, and the requested command-surface simplifications are reflected in runtime behavior.

Constraints/Assumptions:
- Preserve adjacent edits from the active CLI binding-layer, repeatable-flags, selector-normalization, and CLI expansion lanes.
- Keep the scope inside `packages/cli/src/commands/**` plus the directly affected tests; avoid broadening into docs, inbox, export, or unrelated service-layer refactors.
- The worktree is already dirty, so every patch must be based on the live file state and must not revert unrelated edits.

Key decisions:
- Split the existing helper modules by noun/capability instead of introducing another larger shared abstraction layer.
- Prefer repeatable flags or direct typed options over comma-separated parsing when the command surface allows it.
- Preserve compatibility where reasonable, but update the focused CLI tests to reflect the simplified command grammar the user requested.

State:
- completed

Done:
- Re-read the repo routing, architecture, reliability/security, verification, and completion-workflow docs.
- Audited the current `provider-event-read-helpers.ts`, `experiment-journal-vault-read-helpers.ts`, and `samples-audit-read-helpers.ts` responsibilities and the command/test imports that depend on them.
- Registered the active scope in `COORDINATION_LEDGER.md`.
- Split the remaining helper responsibilities into narrower sample, audit, event, and shared query-record modules.
- Collapsed `journal link-*` / `unlink-*` into typed `journal link` / `journal unlink` flags and made `audit tail` a descending `audit list` alias.
- Rejected mixed `journal link` / `journal unlink` target-type invocations until an atomic combined mutation path exists, and normalized repeatable journal flags through the shared helper.
- Removed the leftover unused helper/barrel files so the split lands without dead wrapper layers.
- Re-ran focused CLI runtime coverage for the affected provider/event/sample, journal, and audit flows, including repeated-flag normalization and alias semantics.
- Ran the required top-level verification commands and captured the current unrelated workspace failures.

Now:
- Close the execution plan, remove the ledger row, and commit the scoped changes.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: none.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-cli-helper-module-split.md`
- `packages/cli/src/commands/health-command-factory.ts`
- `packages/cli/src/commands/provider.ts`
- `packages/cli/src/commands/event.ts`
- `packages/cli/src/commands/experiment.ts`
- `packages/cli/src/commands/journal.ts`
- `packages/cli/src/commands/vault.ts`
- `packages/cli/src/commands/samples.ts`
- `packages/cli/src/commands/audit.ts`
- `packages/cli/src/commands/provider-event-read-helpers.ts`
- `packages/cli/src/commands/experiment-journal-vault-read-helpers.ts`
- `packages/cli/src/commands/samples-audit-read-helpers.ts`
- `packages/cli/test/cli-expansion-provider-event-samples.test.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- `packages/cli/test/cli-expansion-samples-audit.test.ts`
- `packages/cli/test/runtime.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Completed: 2026-03-13
