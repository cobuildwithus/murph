# Temporal Orchestration Follow-Up Hardening

## Goal

Land the review follow-ups for the hosted Temporal migration so the per-user
workflow remains signal-responsive and long-lived, Cloudflare stays execution-only,
and web/runtime ownership boundaries stay minimal.

Success criteria:

- `runtime_wake_sent` recheck waits are interruptible by fresh workflow signals.
- Recoverable Cloudflare execution Activity failures do not fail the per-user
  workflow.
- The unused signed AI usage decision handoff is removed from the Cloudflare
  ensure-execution contract and webhook wake handoff path.
- Web AI usage demand gating covers only demand sources that strongly imply model
  work.
- Cloudflare runtime ensure-execution is callback-signature only.
- Workflow code imports only pure orchestration contracts and workflow-local types.
- Mailbox signal coalescing state resets after demand is consumed or satisfied.
- Cloudflare post-completion alarm/log failures do not masquerade as transport
  execution failures.

## Constraints

- Preserve unrelated active worktree edits and active-plan rows.
- Do not expose local identifiers, secrets, raw payloads, or provider data.
- Keep completed execution-plan snapshots immutable; update durable current docs
  instead.

## Working Set

- `packages/hosted-orchestrator-temporal/**`
- `packages/hosted-execution/**`
- `apps/web/src/lib/hosted-orchestration/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/**`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/**`
- `ARCHITECTURE.md`
- `agent-docs/references/**`

## Verification Plan

- Focused hosted-execution, Temporal workflow, hosted-web demand, and Cloudflare
  route/runner tests.
- Affected package/app typechecks where scoped verification is truthful.
- Root `pnpm typecheck` unless still blocked by unrelated dirty work.
- Required completion audits for high-risk auth/retry/runtime changes.
