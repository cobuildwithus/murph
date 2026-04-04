# Hard-cut inboxd linq/telegram compatibility subpaths

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Remove the remaining published `@murphai/inboxd` Linq and Telegram convenience subpaths so the package no longer exposes mixed inbox-normalization plus stateless messaging-ingress helper entrypoints.
- Move the small set of in-repo consumers onto the correct owner packages without changing inbox capture behavior.

## Success criteria

- `packages/inboxd/package.json` no longer exports `./linq`, `./linq-webhook`, `./telegram`, or `./telegram-webhook`.
- In-repo consumers import stateless Telegram/Linq helpers from `@murphai/messaging-ingress` and inbox normalization helpers from `@murphai/inboxd` root instead of the removed convenience subpaths.
- Tests assert the removed compatibility subpaths stay unpublished and the touched package/runtime checks pass.

## Scope

- In scope:
- Remove the stale published subpaths and matching TypeScript path aliases.
- Update the small set of repo callers that still use those subpaths.
- Refresh `packages/inboxd` boundary tests and package docs to match the hard cut.
- Out of scope:
- Changing actual Linq or Telegram normalization behavior.
- Reworking the main `@murphai/inboxd` root barrel beyond what is needed for callers in this task.

## Constraints

- Technical constraints:
- Preserve current inbox normalization and hosted-ingest behavior; this is an ownership-boundary cleanup, not a connector rewrite.
- Avoid touching unrelated dirty assistant-core files beyond the Telegram runtime import seam already in use.
- Product/process constraints:
- Follow repo code workflow: coordination ledger, active plan, required verification, final audit pass, and scoped commit helper.

## Risks and mitigations

1. Risk: Removing published subpaths could leave hidden in-repo callers broken.
   Mitigation: Search the repo for each subpath import, update all direct callers, and add a boundary test that asserts the exports stay absent.
2. Risk: Assistant-core has unrelated in-flight edits nearby.
   Mitigation: Keep the assistant-core change to the import source only and re-read current file content before patching.

## Tasks

1. Register the ledger row and define the narrow boundary-cut plan.
2. Remove the inboxd convenience subpath exports and TS path aliases.
3. Update assistant-runtime and assistant-core callers to use the correct owner packages.
4. Replace the old compatibility-subpath warning test with a removal/boundary test and align package docs.
5. Run required checks, complete the final review audit, address any findings, and finish with a scoped commit.

## Decisions

- Hard-cut the convenience subpaths instead of keeping deprecated wrappers; the repo already documents `@murphai/messaging-ingress` as the owner of shared stateless provider ingress semantics.
- Keep the root `@murphai/inboxd` barrel unchanged for this task; the user concern is the published convenience subpaths, and this narrower cut avoids unnecessary surface churn.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- Focused package tests as needed while iterating
- Expected outcomes:
- Repo-required package-scope verification stays green for the hard cut, and the final audit reports no remaining high-severity boundary regressions.
- Outcomes:
- `pnpm exec vitest run packages/inboxd/test/package-boundary.test.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts packages/cli/test/assistant-channel.test.ts --no-coverage` passed before and after the audit-driven test fix.
- `pnpm typecheck` passed.
- `pnpm test:packages` passed before the audit-driven test fix.
- `pnpm test:smoke` passed.
- Required `task-finish-review` audit found one medium gap: the new boundary test did not prove the replacement normalize subpaths were published/importable. The test was expanded to cover those exports.
- Post-fix rerun of `pnpm test:packages` failed for a credibly unrelated concurrent dirty-tree issue in `packages/hosted-execution/src/web-control-plane.ts` about missing `sharePack` exports; this surface is outside the task scope and was not touched by this diff.
Completed: 2026-04-05
