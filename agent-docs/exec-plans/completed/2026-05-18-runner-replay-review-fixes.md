# Runner Replay Review Fixes Plan

Status: completed
Created: 2026-05-18
Owner: Codex

## Goal

Resolve the concrete bugs and simplifications found by the five-subagent review of hosted runner replay containment, while preserving the original architecture constraints.

Success means:

- No new tables, ledgers, or web round trips in the normal reply path.
- Assistant usage-limit suppression applies to assistant/provider quota exhaustion, not delivery-channel billing failures.
- Common raw provider quota exhaustion text cannot keep scheduling auto-reply retries.
- Repeated runner demand/status-read failures are bounded by the existing runner retry cap.
- Runner parking code expresses the invariant that parked means no active write fence.
- Focused tests cover the new boundaries.

## Constraints

- Do not infer a fresh user-event reset in Cloudflare without a separate explicit reset signal from web.
- Preserve unrelated dirty worktree edits.
- Keep diagnostics metadata-only.
- Keep usage recording asynchronous.

## Implementation Notes

- Mark auto-reply delivery-channel failures with narrow context so usage-limit classification can ignore them.
- Expand terminal usage-limit text coverage for clear quota exhaustion while keeping generic rate-limit signals retryable.
- Count runner progress-demand read failures through existing runner failure state and park at cap.
- Remove unreachable active-write-fence branch in the runner parking helper.
- Add focused regression tests for delivery billing text, raw quota exhaustion, status-read cap, and small runner simplification behavior where practical.
- Preserve active write-fence alarm reporting when status reads fail.
- Treat rejected delivery/outbox errors as delivery-boundary failures before provider quota text matching.

## Review

- Five review subagents inspected the replay-containment commit and found concrete issues in status-read retry bounding, terminal quota text detection, delivery/provider authority boundaries, active-fence parking projection, and alarm reporting.
- Follow-up simplify/security/coverage/final-review agents found and closed two additional boundary gaps: status-read failure reporting behind an active write fence, and rejected delivery quota failures reaching provider usage-limit suppression.
- Final task-finish review returned no findings.

## Verification

Passed:

```bash
pnpm exec vitest run apps/cloudflare/test/user-runner-alarm.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage
pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts
pnpm --dir apps/cloudflare typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --dir apps/cloudflare verify
pnpm --dir packages/assistant-engine test:coverage
pnpm typecheck
git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts packages/assistant-engine/src/assistant/automation/auto-reply-retry.ts packages/assistant-engine/src/assistant/automation/reply.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts agent-docs/exec-plans/active/2026-05-18-runner-replay-review-fixes.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```
Updated: 2026-05-18
Completed: 2026-05-18
