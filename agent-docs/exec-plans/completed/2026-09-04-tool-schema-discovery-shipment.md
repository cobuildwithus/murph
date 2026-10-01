# Tool schema discovery proof and shipment

Status: completed

## Outcome and ownership

Continue PR #2810 from its clean handed-off head c55a35488be2044575993092936acc2a782ece82 under the user's request to improve and ship it. Retain the reviewed mixed-mode implementation in the existing production and hosted-local catalog owners. No other session changes were present at handoff.

## Evidence and scope

Codex 0.151.0 supplies generated declarations through ALL_TOOLS, but its renderer follows oneOf branches without combining shared sibling properties. Murph's automation declaration consequently exposes contextReferences as unknown despite the JSON schema retaining entityKind and entityId. The original unprojected schema also loses nested detail through Codex schema compaction. Native search in mixed mode retains the required nested reference shape.

- Add deterministic code-only characterization beside the existing positive mixed-mode regression.
- Extend the production-derived live Terra journey with an ordinary request that prescribes no discovery interface or tool sequence.
- Correct live owner documentation and PR rationale; keep the original completed plan immutable.
- Run focused tests and typecheck, review the final candidate, satisfy applicable PR gates, merge, and deploy through the protected owner workflow.
- Verify the deployed revision and available production smoke evidence; retire the task worktree after shipment.

## Protected invariants and product walkthrough

One canonical condition read precedes one successful reminder save with its exact reference and requested local time. The ordinary journey may use either native discovery or code execution. Existing validation, permissions, scheduling, and delivery ownership remain unchanged. Synthetic fixtures never contact production member or delivery services. Product UX effort: Patch; ordinary-request walkthrough Ready after a truthful daily-time confirmation and exactly one accepted save.

## Deployment

The user authorized merging and shipping. Use the existing protected Murph Cloud workflow, keeping production credentials in its hosted environment. Existing old containers retain the previous discovery limitation until replacement; there is no data or protocol migration. Verify managed-container smoke and the deployed image before considering the runtime shipped. Web changes only publish the static changelog.

## Verification record

- Focused scripted code-only characterization and mixed-mode positive regression: 2 passed. The code-only declaration loses the nested reference shape while the original JSON schema retains it; the mixed-mode search returns the complete schema before one save.
- Adopted main's stronger existing signup-link prompt assertion to remove its test-only overlap: 2 passed. No production logic changed.
- Assistant-engine typecheck passed after the final test edits; complexity guard and diff whitespace check passed.
- Ordinary-request live Terra journey passed through local subscription auth: one canonical read, one accepted save with the exact condition reference and daily 09:00 schedule, and a concise truthful reply. No discovery interface or incidental reasoning order was prescribed. The live test body completed in 24.29 seconds; this is a single synthetic sample, not a latency SLO.
- Prior substantive ReviewGPT PASS at deeb2d3afee35ee59cdcbd48fc23bf35a1fa1f10 remains applicable under the explicit isolated-test/explanatory-doc rerun rule. Both production catalog owners are byte-for-byte unchanged from that reviewed head.
- Prescribed live Terra regression also passed through local subscription auth: one canonical read, one native schema search returning the required nested reference shape, one accepted save, and a truthful daily 09:00 confirmation. The test body completed in 38.86 seconds. Both live replies meet the Ready UX bar. Commands: `pnpm test:assistant:live -- --test 'ordinary reminder request'` and the same command with `'prescribed schema discovery'`.
- Parent final review found no additional production change or abstraction justified. Final-head required CI, merge, and protected deployment are the remaining shipment gates; their receipts belong to the PR and final handoff rather than edits to an immutable completed implementation plan.
Updated: 2026-09-04
Completed: 2026-09-04
