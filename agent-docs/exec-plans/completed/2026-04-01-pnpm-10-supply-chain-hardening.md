# Land patch stack for pnpm hardening and hosted runtime follow-ups

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Land the supplied patch stack so the repo pins pnpm 10.33.0 exactly with the tighter workspace supply-chain policy, shares hosted bundle payload-identity helpers across runtime-state/hosted-execution/Cloudflare, and extracts the hosted runner queue plus gateway-local assistant seams without disturbing unrelated worktree state.

## Success criteria

- Root manifest pins pnpm 10.33.0 in both `packageManager` and `engines.pnpm`.
- `pnpm-workspace.yaml` carries the reviewed supply-chain controls and minimal `allowBuilds` list from the patch.
- `scripts/verify-dependency-policy.mjs` fails when those controls drift.
- Hosted bundle payload equality is shared through runtime-state helpers and reused by hosted-execution and Cloudflare write/journal/runner paths.
- Hosted runner queue schema/projection helpers are extracted without regressing eager malformed-state repair or bundle-version semantics.
- gateway-local uses an explicit assistant adapter seam for source reads and local send delivery without changing local behavior.
- Required verification for the touched surface is recorded, with unrelated repo-wide failures called out explicitly if they remain.

## Scope

- In scope: root package-manager pinning, pnpm workspace policy, dependency-policy guard script, touched repo docs, the two touched shell wrappers plus the Cloudflare deploy doc, hosted bundle/runtime-state/hosted-execution/Cloudflare simplifications, and the hosted runner queue plus gateway-local assistant adapter extractions.
- Out of scope: unrelated dependency upgrades beyond the required workspace edge and lockfile refresh, unrelated dirty-tree files such as the generated doc inventory, and unrelated active rows in the coordination ledger.

## Constraints

- Technical constraints: preserve the committed dependency-source policy, avoid widening `allowBuilds` beyond the reviewed set, keep shell/doc updates aligned with the live repo scripts, keep hosted bundle equality based on payload identity rather than `updatedAt`, and preserve current runner/gateway behavior while extracting helper seams.
- Product/process constraints: preserve unrelated worktree edits, follow the repo completion workflow for high-risk config work and repo code changes, and close the plan through `scripts/finish-task` if the combined change is committed.

## Risks and mitigations

1. Risk: pnpm 10 policy keys or exact package-manager integrity may differ from the live toolchain and cause verification churn.
   Mitigation: inspect the live manifests first, apply the patch intent narrowly, and verify with the repo guard script plus required checks.
2. Risk: hosted bundle or runner queue simplifications could accidentally change payload-identity, bundle-version, or malformed-state repair behavior.
   Mitigation: preserve the newer live-tree semantics while extracting helpers, and verify with focused runtime-state and Cloudflare tests.
3. Risk: repo-wide verification may already be red for unrelated reasons, making it easy to misattribute failures.
   Mitigation: run direct touched-surface checks first, rerun the repo commands on the final tree, and separate unrelated pre-existing failures explicitly.

## Tasks

1. Port the supplied patch stack intent into the live tree, resolving drift in docs, scripts, dependency policy, hosted bundle helpers, Cloudflare runner code, and gateway-local seams.
2. Run the dependency-policy/script validation plus focused package/app verification and direct scenario proof for the touched runtime surfaces.
3. Rerun the repo verification baseline on the final combined tree, document any unrelated pre-existing failures precisely, run the required completion-review audit, address findings, and finish the task with a scoped commit.

## Decisions

- Use a dedicated execution plan instead of staying ledger-only because the combined patch stack spans root config/docs/scripts plus multiple runtime packages and apps.
- Treat the supplied patches as intent only; adapt them to the newer live tree instead of overwriting newer hosted runner behavior.
- Accept the required lockfile refresh once `@murph/hosted-execution` gained a new workspace dependency on `@murph/runtime-state`.

## Verification

- Commands to run: dependency-policy validation, shell syntax checks for touched wrappers, focused typechecks/tests for runtime-state/hosted-execution/Cloudflare/gateway-local plus direct bundle-write scenario proof, and the repo-required verification commands for the final combined tree.
- Expected outcomes: the pnpm policy guard accepts the new settings, hosted bundle and runner/gateway focused checks stay green, and repo verification is either green or any unrelated pre-existing failure is documented precisely.
Completed: 2026-04-01
