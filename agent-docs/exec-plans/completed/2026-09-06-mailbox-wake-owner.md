# Preserve system mailbox callback wake ownership

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal and invariant

Preserve the queue-selected wake time and reason after callback outcomes. A failed item's retry remains durable without relabeling another eligible item. No schema, protocol, scheduler or selection-policy change.

## Evidence and scope

The retry branch takes a queue timestamp and attaches the failed item's reason; the terminal branch omits the selected reason. Correct both at the existing mailbox owner. Preserve approved continuation priority, independent device deadlines, delivery intent promotion and post-checkpoint ordering.

## Tasks

1. Reproduce retry and terminal ownership mismatches with persisted queue and subsequent admission assertions.
2. Preserve the selected candidate through the existing callback result and consumers.
3. Run focused mailbox and composed checkpoint tests, package typecheck, complexity and docs checks.
4. Open a scoped PR; complete exact-head GPT-6 Pro review concurrently with required CI and resolve findings.

## Product UX

Effort: Patch. Recovery uses the correct existing processing owner. No new messages, audience, prompts or provider input. Cover approved work, device retry and terminal clinical callback outcomes. Status: Ready. Persisted callback, next-admission and composed checkpoint scenarios pass.

## Compatibility

No persisted shape or external contract changes. Old and new binaries read the same state. No claim this source inconsistency caused a particular production alert.

## Verification

- Before the correction, new assertions reproduced the wrong approval wake reason and missing device reason after all three terminal clinical outcomes.
- Mailbox notification and state suites: 106 tests passed.
- Workspace system-mailbox and scheduling suites: 94 tests passed, including approval handling, dirty callback checkpointing and independently retained device deadlines.
- Assistant-runtime typecheck, complexity guard, docs drift and whitespace checks passed. Existing complexity debt and maximum are unchanged; no new policy helper or state was added.
- A root ESLint invocation was unavailable because the root package does not expose that binary; no Web source changed. Package typecheck, focused runtime tests and exact-head CI cover the changed owner.
- Final pushed-head ReviewGPT and required CI remain external PR gates; this plan records completed implementation and local proof, not production adoption.
Completed: 2026-09-06
