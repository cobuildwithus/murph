# Inbox routing safety follow-up

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Tighten inbox assistant routing scope and file-path safety based on the provided review follow-up patch while keeping the shared assistant harness reusable for later chat flows.

## Success criteria

- Inbox routing uses a narrower assistant tool preset than the default shared catalog.
- Assistant-selected file paths and derived/parser reads stay confined to the vault root.
- Routing text no longer duplicates the tool catalog already present in `bundle.tools`.
- Focused tests cover the narrowed routing preset and vault-bound file handling.
- Required verification passes, or any unrelated blockers are clearly documented.

## Scope

- In scope:
- `packages/cli/src/assistant-cli-tools.ts`
- `packages/cli/src/inbox-model-harness.ts`
- `packages/cli/test/inbox-model-harness.test.ts`
- related coordination/generated-doc updates caused by the normal workflow
- Out of scope:
- fail-fast changes for multi-action apply execution
- broader chat tool-profile redesign beyond the narrow inbox-routing preset

## Constraints

- Preserve the shared assistant model/tool layer while narrowing only the inbox routing preset.
- Keep path hardening strictly vault-root based; do not broaden filesystem access.
- Stay close to the provided patch unless the current repo state requires a small adaptation.

## Risks and mitigations

1. Risk: narrowing the inbox routing tool catalog may accidentally remove useful direct-write tools.
   Mitigation: keep the default catalog broad and introduce a dedicated inbox-routing preset instead of mutating the shared default.
2. Risk: new vault-bound path checks could break legitimate reads if relative-path assumptions differ across helper call sites.
   Mitigation: apply the same vault-root resolution pattern to both assistant write tools and derived/parser reads, then verify with focused tests.
3. Risk: prompt-bundle changes may subtly affect routing behavior.
   Mitigation: only remove duplicated tool text from `routingText`; keep `bundle.tools` and the main placement prompt unchanged.

## Tasks

1. Register active work and align the provided patch against the current tree.
2. Add the inbox-routing catalog preset and route inbox bundle creation through it.
3. Enforce vault-root path resolution for assistant file inputs and derived/parser reads.
4. Update focused inbox assistant tests for the narrowed catalog and path failures.
5. Run required verification plus completion-workflow audit passes, then close the coordination docs and commit.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Focused package checks are allowed earlier to validate the patch surface before running the full repo commands.

## Outcome

- Inbox routing now uses a dedicated assistant tool preset that omits query tools and the stateful write tools that are noisy or unsafe for fresh capture routing.
- Assistant-controlled file paths and derived/parser text reads now share one on-disk vault-bound path guard, including symlink traversal rejection.
- Routing bundles keep the tool catalog in `bundle.tools` and no longer duplicate it inside `routingText`.
- Focused tests cover the narrowed routing preset, lexical path escape rejection, symlink escape rejection, and the removed routing-text duplication.

## Verification results

- Passed: `pnpm --dir packages/cli typecheck`
- Passed: `pnpm exec vitest run packages/cli/test/inbox-model-harness.test.ts packages/cli/test/assistant-harness.test.ts packages/cli/test/inbox-model-route.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm typecheck`
- Failed, unrelated to this diff: `pnpm test`
  - failing targets: `packages/cli/test/selector-filter-normalization.test.ts`, `packages/cli/test/stdin-input.test.ts`, `packages/cli/test/setup-cli.test.ts`
  - rationale: the remaining failures are outside the inbox assistant files changed here; `setup-cli.test.ts` also overlaps unrelated in-progress worktree edits under the setup/README lane
- Failed, unrelated to this diff: `pnpm test:coverage`
  - same failing targets and rationale as `pnpm test`
- Final completion audit: no actionable findings on the current inbox assistant change set; residual risk is limited to the explicit symlink-rejection policy and the unrelated red repo tests above
Completed: 2026-03-16
