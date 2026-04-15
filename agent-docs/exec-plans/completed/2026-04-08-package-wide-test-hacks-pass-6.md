# Package-wide final pass for source-level test hacks and duplicated test patterns

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run a broader final pass across whole clean packages instead of single files.
- Look for source-level hacks or extra seams that appear to exist mainly to make tests easier.
- Clean up remaining duplicated test code in the same package when it is clearly worthwhile.

## Success criteria

- Five package-wide workers each own one clean package slice.
- Any unnecessary source-level testing seam found in those packages is removed or simplified.
- Test cleanup stays package-local and avoids the current dirty worktree lanes.
- Focused package verification passes for touched packages.

## Scope

- In scope:
- package-wide review and cleanup inside `packages/{assistant-cli,device-syncd,importers,operator-config,setup-cli}/**`
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-package-wide-test-hacks-pass-6.md}`
- Out of scope:
- packages with active dirty source/test files from other lanes
- broad coverage-threshold work
- runtime refactors not tied to a concrete testing seam or duplicated test pattern

## Risks and mitigations

1. Risk:
   Package-wide workers overlap with adjacent dirty work.
   Mitigation:
   Restrict to packages that are currently clean at the source/test seam level and tell workers to preserve all unrelated edits.
2. Risk:
   Removing a seam that is actually part of a legitimate public or runtime boundary.
   Mitigation:
   Require a concrete justification before changing source-level seams; otherwise prefer test-only cleanup.
3. Risk:
   Broad review creates churn with little value.
   Mitigation:
   Keep each worker focused on high-signal duplicated code and source/test coupling only.

## Tasks

1. Register the package-wide pass in the coordination ledger.
2. Spawn five GPT-5.4 medium-reasoning workers, one per package.
3. Review landed diffs locally and do any minimal follow-up needed.
4. Run focused package verification and a final audit pass.
5. Summarize package-wide outcomes and residual risks.

## Verification

- focused package-local tests and typechecks for touched packages
- `pnpm typecheck` if still green
Completed: 2026-04-08
