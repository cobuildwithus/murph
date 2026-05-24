Goal: Close the confirmed follow-up gaps from the DeepSec high-bug subagent architecture review without broadening the original fix slice.

Constraints:
- Keep changes small, composable, and owned by existing routing/runtime/core primitives.
- Preserve unrelated dirty worktree changes and active plans.
- Do not expose secrets, identifiers, local paths, or private payloads in code, docs, logs, or test output.

Scope:
- Make verified-email hosted member lookup blind-index rotation safe.
- Fail closed when configured hosted device sync lacks its control-plane port.
- Remove unreachable hosted control-plane soft-fail branches after the fail-closed invariant.
- Consider only simple follow-up cleanup if it directly reduces complexity in this slice.

Verification:
- Focused hosted onboarding tests.
- Focused assistant-runtime tests.
- Focused core tests if canonical-lock code changes.
- `pnpm typecheck` unless blocked by unrelated dirty work.
- Diff whitespace and privacy scans.
Status: completed
Updated: 2026-05-24
Completed: 2026-05-24
