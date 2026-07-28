Goal (incl. success criteria):
- Resolve the exact-head CI failure on PR #987 without weakening the Temporal workflow bundle dependency policy.
- Keep the managed-group activity window implementation shared between Web and assistant evidence while removing `@murphai/contracts` from the Temporal workflow source closure.
- Resolve final ReviewGPT round 1's privacy and Telegram threshold findings with fail-closed projections and no new state owner.
- Success means both host-matrix builds pass, focused managed-group window coverage remains green, and the final ReviewGPT correction round accepts the remediation.

Constraints/Assumptions:
- Preserve the approved group automation behavior, contracts, threshold, window semantics, and public type ownership.
- Follow the existing workflow bundle policy's leaf-module remedy.
- Do not change dependencies or the lockfile.
- Keep the final ReviewGPT first-reviewed baseline at `9f56fa6c4d9d836dad47484cd69058b36c813813`.

Key decisions:
- Treat the identical macOS and Ubuntu failures as introduced: the new window helper added a forbidden contracts dependency to `runtime-control.ts`, which is imported by the Temporal workflow.
- Move only the window calculation into a dedicated hosted-execution public leaf entrypoint; retain activity policy/request/response types in `runtime-control.ts`.
- Verify the actual hosted-orchestrator build, not only the unit policy fixture.
- Project recap evidence from committed user prompts to only an aliased authoritative sender and its message text; omit assistant turns and every prompt metadata/context section.
- Count Telegram input only when the exact group envelope has nonblank normalized text or at least one parsed media attachment.

State:
- Ready to commit.

Done:
- Captured both failing job logs and proved the shared source-closure cause.
- Extracted the shared window helper, updated its consumers and export inventory, and passed the real Temporal build plus the full acceptance suite.
- Final ReviewGPT round 1 found two original-patch defects: persisted reaction/route metadata could enter recap evidence, and contentless Telegram service events could count toward the threshold.
- Replaced generic transcript reuse with a fail-closed projection that admits committed user messages only, retains only aliased sender plus message text, and omits every assistant and metadata/context section.
- Added a production-built Linq prompt regression containing a reaction-only second participant, actor/thread identifiers, message reference, and attachment metadata; none reaches recap evidence.
- Required Telegram input to carry nonblank text or parsed media and proved 99 human messages plus one service update remains ineligible while the hundredth media-only message is eligible.
- Passed focused engine/Web tests and typechecks, the real Temporal build, the conservative canonical `pnpm test:diff ...`, and the full `pnpm verify:acceptance`.

Now:
- Commit and push the exact remediation.

Next:
- Run final ReviewGPT correction round 2 against the immutable first-reviewed baseline and wait for replacement CI on the new head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/managed-group-activity.ts`
- `packages/hosted-execution/package.json`
- `packages/hosted-execution/test/managed-group-activity.test.ts`
- `packages/assistant-engine/src/assistant/maintenance-evidence.ts`
- `packages/assistant-engine/test/maintenance-evidence.test.ts`
- `apps/web/src/lib/hosted-groups/managed-group-activity-decision.ts`
- `apps/web/test/managed-group-activity-decision.test.ts`
- `packages/hosted-orchestrator-temporal` build and bundle policy
- `pnpm test:diff ...`
- `pnpm verify:acceptance`
Status: completed
Updated: 2026-07-26
Completed: 2026-07-26
