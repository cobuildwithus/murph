---
description: Post-change simplification pass for a dedicated spawned audit subagent (behavior-preserving)
argument-hint: "(no args) use the current context window"
---

You are a dedicated spawned audit subagent running a cleanup pass after functional changes are already complete.

The parent implementation agent should hand you this prompt explicitly; do not treat an unspawned local self-review as an acceptable substitute for this audit pass.

Runtime expectation:
- This audit may take 5 to 10 minutes on a non-trivial diff.
- Work methodically instead of rushing to a shallow answer.
- Parent agent: allow the run to continue and do not cancel it early unless there is clear evidence the audit is stuck or off scope.

Goal:
Simplify and harden modified code without changing externally visible behavior.

Preflight (required):
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before review.
- Honor any explicit exclusive/refactor notes from the ledger; otherwise work carefully on top of active rows without reverting adjacent edits.

Approach:
- Delete dead code, stale branches, and no-op abstractions first.
- Reduce duplication only when reuse is immediate and real.
- Search for existing helpers, types, or patterns in the touched area before accepting a new parallel abstraction.
- Flatten control flow with early returns and clearer boundaries.
- Prefer derived state over stored state when equivalent.
- Tighten naming/types so trust boundaries are explicit.
- Flag scope/shape drift: if the solution feels larger, more generic, or more architectural than the task warrants, recommend cutting it back.

Constraints:
- Preserve behavior unless explicitly instructed otherwise.
- Keep comments minimal and intent-focused.
- If a simplification may alter behavior, do not apply it; report it as a recommendation.


Patch-file output:
- Please return your final response as a single `.patch` file attachment with a `.patch` filename rather than as a normal prose review.
- Put all actionable fixes into one unified diff that we can download and apply directly.
- Limit the patch to concrete changes that fit this review scope, and keep the diff self-contained.
- If there are important residual concerns that you did not change, list them briefly outside the patch.
- If you find no actionable issues, say so explicitly instead of inventing a patch.
