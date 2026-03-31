# Migrate assistant-state off healthybob and stop old-path writes

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Ensure Murph stops recreating the legacy `healthybob` workspace directory after the repo rename, while preserving existing assistant-state data and making future runs use the current Murph-local assistant-state path.

## Success criteria

- New Murph runtime-state code resolves the current assistant-state bucket from the active vault path and can safely migrate legacy assistant-state data created before the repo rename.
- Existing assistant-state data from the legacy `healthybob` location is preserved under the Murph repo and reachable from the current runtime path.
- Stale healthybob-linked background processes are stopped and the `healthybob` directory can be removed without reappearing during verification.
- Required verification and direct proof cover both the code path and the on-disk migration behavior.

## Scope

- In scope:
- `packages/runtime-state` assistant-state path and migration helpers
- focused runtime-state tests for rename-safe migration behavior
- architecture docs only if the durable assistant-state location/migration rule changes materially
- operational cleanup of stale healthybob-linked Murph processes plus one-time local assistant-state move/delete verification
- Out of scope:
- unrelated assistant/provider routing work already in progress elsewhere in the repo
- broader package rename cleanup for historical docs, logs, or package-history strings that do not affect runtime writes

## Constraints

- Technical constraints:
- preserve assistant-state permissions and avoid copying secrets into logs or diffs
- do not guess between multiple unrelated assistant-state buckets; migration must stay conservative
- preserve unrelated dirty-tree edits
- Product/process constraints:
- follow the high-risk repo workflow with plan, ledger, full verification, required audits, and a scoped commit

## Risks and mitigations

1. Risk:
   Moving the wrong assistant-state bucket could orphan or corrupt live local assistant data.
   Mitigation:
   Only migrate when the legacy candidate is uniquely attributable to the current vault rename path, prefer rename/move over ad hoc rewriting, and add focused tests for the decision logic.
2. Risk:
   Stale background processes may recreate `healthybob` during verification and hide code-path correctness.
   Mitigation:
   Stop the known healthybob-linked process tree before final filesystem verification and record the process classes removed.

## Tasks

1. Inspect assistant-state/runtime-state path resolution and current on-disk bucket layout.
2. Implement conservative legacy-bucket detection and migration for renamed local vault roots.
3. Add focused tests covering the rename migration path and non-migration guardrails.
4. Migrate the live local assistant-state data, stop stale healthybob-linked processes, and verify the old directory stays gone.
5. Run required verification, complete required audits, and land a scoped commit.

## Decisions

- Initial assumption: the recreated `healthybob` directory is caused by pre-rename long-lived Murph processes still resolving assistant-state against the old vault root.
- Implementation decision: adopt legacy assistant-state buckets only when the current bucket is missing and exactly one sibling bucket with the same vault-directory basename exists under the same `assistant-state` parent. Ambiguous sibling sets stay untouched.
- Operational decision: merge the last files written under the regenerated top-level `healthybob/assistant-state` stub back into Murph before renaming the repo-local bucket to the new Murph hash.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- focused direct proof for assistant-state migration and no-recreated-`healthybob` cleanup
- Expected outcomes:
- required commands pass or produce a clearly unrelated pre-existing failure with evidence
- direct proof shows Murph can use the migrated assistant-state without recreating `healthybob`
- Actual outcomes:
- `pnpm --dir packages/runtime-state typecheck`: passed
- `pnpm --dir packages/runtime-state test`: passed
- `pnpm typecheck`: passed
- `pnpm test:smoke`: passed
- `pnpm test:packages`: failed for a pre-existing unrelated `packages/contracts/scripts/verify.ts` import mismatch (`isStrictIsoDate`, `isStrictIsoDateTime`, `normalizeStrictIsoTimestamp` missing from `@murph/contracts`)
- Direct proof: after killing all live processes whose command lines still referenced the old repo path, `healthybob` stayed absent after delayed checks, and `pnpm exec tsx packages/cli/src/bin.ts assistant status --vault ./vault --json` reported the Murph-local vault and assistant-state bucket (`~/startup1/murph/vault` and `~/startup1/murph/assistant-state/vault-dbf1238f7f34`)
Completed: 2026-03-31
