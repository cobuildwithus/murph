# Contracts taxonomy and frontmatter tolerance

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Make the documented command taxonomy section truthful against `packages/contracts/src/command-capabilities.ts`.
- Make tolerant frontmatter parsing actually tolerant when malformed quoted scalars are encountered.

## Success criteria

- `packages/contracts/src/command-capabilities.ts` publishes the documented bundle/noun/alias taxonomy used in the command-surface contract section, including the currently missing assistant, memory, automation, and device surfaces.
- The documented taxonomy no longer drifts silently: a focused contracts test fails if the bundle/noun/alias section in `docs/contracts/03-command-surface.md` no longer matches the exported registry.
- Tolerant `parseFrontmatterDocument()` no longer leaks raw `SyntaxError` for malformed quoted scalars and falls back cleanly instead.
- Focused contracts tests and required repo verification pass, or any unrelated blocker is named precisely.

## Scope

- In scope:
  - `docs/contracts/03-command-surface.md`
  - `packages/contracts/src/{command-capabilities,frontmatter}.ts`
  - directly coupled `packages/contracts/test/**`
  - `agent-docs/exec-plans/active/{2026-04-23-contract-taxonomy-frontmatter-tolerance.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - CLI command-registration changes
  - broader command-surface contract rewrites outside the taxonomy section under review
  - unrelated contracts/schema/doc cleanup already present in the repo

## Constraints

- Preserve unrelated dirty-tree edits and keep this lane limited to the contracts/doc/test seam.
- Do not claim `command-capabilities.ts` is the source of truth for more than it actually models; if needed, narrow the doc claim to the exact taxonomy section covered here.
- Keep the frontmatter fix minimal: convert malformed quoted-scalar failures into the existing tolerant fallback path without changing successful parse behavior.

## Risks and mitigations

1. Risk: expanding the command registry could accidentally promise command surfaces that still are not modeled exactly.
   Mitigation: scope the doc claim to the exact bundle/noun/alias taxonomy covered here and add a drift test for that section.
2. Risk: frontmatter error handling changes could mask real strict-mode failures.
   Mitigation: keep strict mode throwing the existing typed error path while tolerant mode alone falls back cleanly.
3. Risk: the shared contracts test lane may be sensitive to doc formatting churn.
   Mitigation: keep the drift test targeted to the exact section headings and bullet formats already used in the contract doc.

## Tasks

1. Register the active plan and ledger row.
2. Expand `command-capabilities.ts` to cover the documented taxonomy section and align the doc wording with that actual ownership boundary.
3. Convert malformed quoted-scalar parse failures into `FrontmatterParseFailure` so tolerant mode falls back correctly.
4. Add focused contracts regressions for doc drift and tolerant malformed quoted frontmatter.
5. Run scoped verification, required audits, and the scoped commit flow.

## Decisions

- Treat the command-taxonomy section, not the entire command synopsis block, as the ownership boundary for `command-capabilities.ts` in this fix.
- Keep the frontmatter parser contract unchanged for successful inputs and strict-mode failures; only the tolerant malformed-quoted-scalar path changes behavior.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff docs/contracts/03-command-surface.md packages/contracts/src/command-capabilities.ts packages/contracts/src/frontmatter.ts packages/contracts/test/time-validate-command-capabilities.test.ts packages/contracts/test/frontmatter-validate.test.ts`
  - `pnpm test:smoke`
- Direct proof:
  - Focused contracts Vitest coverage for the command-taxonomy drift guard and malformed quoted-frontmatter tolerant fallback.

## Outcome

- Expanded the shared contracts command-taxonomy registry so the documented bundle/noun/alias section now has one code-owned source for the missing assistant, memory, automation, device, supplement, and related noun surfaces, while also publishing exact per-surface capabilities for downstream consumers.
- Narrowed the command-surface doc claim to that taxonomy section and tightened the noun-composition prose where it still overstated bundle coverage for `document`, `meal`, `intake`, `samples`, `vault`, `export`, and `audit`.
- Hardened frontmatter scalar parsing so malformed quoted scalars become typed `invalid_scalar` failures and tolerant mode falls back cleanly instead of leaking raw `SyntaxError`.
- Added focused regressions for the taxonomy doc-drift guard plus strict/tolerant malformed quoted-frontmatter behavior.
- No scoped commit was created because `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` already carried unrelated concurrent edits before this task, and the required `scripts/finish-task` path would have absorbed that shared ledger churn into this commit.
Completed: 2026-04-24
