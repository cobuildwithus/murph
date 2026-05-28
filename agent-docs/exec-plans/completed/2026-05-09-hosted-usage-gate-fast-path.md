# Hosted usage gate fast path

Status: handoff-blocked
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Avoid a normal-path web round trip before Cloudflare starts a hosted runner invocation when web already allowed foreground AI usage for the same member.

## Success criteria

- Hosted web can attach a short-lived signed AI usage allow decision to runner nudges.
- Cloudflare validates the signed allow decision for user, freshness, and signature before skipping the live usage-gate callback.
- Cloudflare falls back to the live hosted AI usage gate when the allow decision is missing, stale, malformed, for another user, or denied.
- `idle_shutdown_checkpoint` remains exempt from foreground AI usage gating.
- Focused web, Cloudflare, and shared control tests pass.

## Scope

- In scope:
  - Shared hosted control nudge request contract/client.
  - Hosted web usage-gate signing helper and Linq nudge call path.
  - Cloudflare nudge body parsing and pre-invocation signed allow validation.
  - Focused tests for fast path and fallback behavior.
- Out of scope:
  - Changing allowance math, Stripe billing, or usage recording.
  - Making Cloudflare a usage ledger or entitlement source of truth.
  - Removing the live Cloudflare usage-gate fallback.

## Constraints

- `apps/web` remains the canonical owner of hosted AI usage policy/accounting.
- A nudge is not entitlement proof unless it carries a fresh valid web-signed allow decision.
- Preserve deploy compatibility: consumers must tolerate old producers with no allow decision.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: A stale signed allow could authorize spend after entitlement changes.
   Mitigation: Keep the allow decision short-lived and require Cloudflare freshness validation.
2. Risk: A token could be replayed across users.
   Mitigation: Bind the signed payload to the member/user id, verify it against the Durable Object user, and consume the nonce once in Durable Object storage.
3. Risk: Protocol skew during deployment.
   Mitigation: Keep the request body optional and fall back to the live gate when absent or invalid.

## Tasks

1. Add a shared signed allow decision request shape.
2. Generate allow decisions in hosted web after a live allow.
3. Send the decision on Linq runner nudges.
4. Validate the decision in Cloudflare before the live usage gate.
5. Add focused tests and run required verification/audits.

## Verification

- Passed:
  - `pnpm --filter @murphai/hosted-execution typecheck`
  - `pnpm --filter @murphai/hosted-execution test -- hosted-runtime-control.test.ts`
  - `pnpm --filter @murphai/cloudflare-hosted-control typecheck`
  - `pnpm --filter @murphai/cloudflare-hosted-control test -- client.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/index.test.ts test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-execution --no-coverage test/hosted-execution-handoff.test.ts`
  - `git diff --check -- <scoped task paths>`
- Blocked/unrelated:
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-integrations --no-coverage test/hosted-onboarding-linq-dispatch.test.ts` fails before collection because `server-only` is missing through `apps/web/src/lib/legal/consent.ts`.
  - `bash scripts/workspace-verify.sh test:diff <scoped task paths>` fails in `apps/cloudflare verify` because unrelated assistant-engine edits currently make Cloudflare typecheck see missing `executionContext` properties.

## Handoff

- Implementation complete but not committed because multiple scoped files also contain unrelated dirty hunks from active work, including the Cloudflare workflow, deploy docs, `apps/cloudflare/src/user-runner.ts`, and `apps/cloudflare/test/user-runner-alarm.test.ts`.
