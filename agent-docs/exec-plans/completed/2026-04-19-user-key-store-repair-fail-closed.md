# Fail closed on hosted root-key envelope repair outside activation

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Make hosted runtime crypto access fail closed unless the durable root-key envelope is already current, fully managed-recipient-aligned, and readable from the current object-key location.
- Keep all envelope bootstrap, rewrite, and managed-recipient reconciliation writes owned by activation provisioning or an explicit future repair path.

## Success criteria

- `requireUserCryptoContext(... accessMode: "require-existing")` performs read-only envelope lookup plus unwrap only.
- Missing envelopes, legacy object-key placement, or managed-recipient drift raise an explicit repair-needed error instead of mutating storage.
- Activation provisioning still retains the existing ability to bootstrap and reconcile managed recipients.
- Focused Cloudflare tests prove runtime access leaves storage unchanged in the legacy-location and recipient-drift cases.

## Scope

- In scope:
- `apps/cloudflare/src/user-key-store.ts`
- Focused `apps/cloudflare/test/user-key-store.test.ts` updates
- Out of scope:
- Broader hosted activation flow redesign
- Any new generic repair API beyond explicit fail-closed error signaling

## Constraints

- Technical constraints:
- Do not weaken the existing fail-closed posture for missing crypto.
- Preserve activation-time provisioning as the only implicit correctness-writing owner.
- Product/process constraints:
- Preserve unrelated in-flight Cloudflare and web worktree edits.
- Follow the high-risk trust-boundary verification and audit path.

## Risks and mitigations

1. Risk: Runtime access could still mutate storage through a shared helper path.
   Mitigation: Split read-only and repair-capable envelope handling explicitly by access mode and add negative tests that assert the stored object set and envelope payload stay unchanged.
2. Risk: Activation provisioning could accidentally lose the existing reconciliation path.
   Mitigation: Keep activation coverage intact and limit the fail-closed branch to `require-existing`.

## Tasks

1. Register the task in the coordination ledger and capture scope plus verification in this plan.
2. Refactor hosted root-key envelope resolution so runtime access only reads and unwraps.
3. Add focused fail-closed tests for legacy object-key placement and managed-recipient drift.
4. Run required verification and completion audits, then commit with the plan artifact.

## Decisions

- Use an explicit repair-needed runtime error rather than silently returning a degraded status, so callers fail closed without guessing whether repair happened.
- Keep the smallest production change in `user-key-store.ts` instead of introducing a new service abstraction.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/user-key-store.ts apps/cloudflare/test/user-key-store.test.ts`
- Required completion-workflow audits: `coverage-write` on `gpt-5.4-mini`, then `task-finish-review`
- Expected outcomes:
- Cloudflare scoped coverage passes with new fail-closed proofs.
- No runtime/status/browser-vault path writes the durable root-key envelope outside activation provisioning.
Completed: 2026-04-19
