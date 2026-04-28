# Worker 06: Hosted Runtime And Cloudflare Codex

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/RELIABILITY.md`

## Ownership

You own hosted runtime consumption of Codex config and Cloudflare runner coordination:

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/src/hosted-env-categories.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `apps/cloudflare/src/**`
- `Dockerfile.cloudflare-hosted-runner`
- `Dockerfile.cloudflare-hosted-runner-base`
- directly coupled hosted runtime/cloudflare tests only when required

Avoid editing operator-config source; Worker 01 owns config contracts. Consume its exports. Avoid assistant-engine runner internals; Worker 02 owns those.

## Goal

Hosted execution should run Codex App Server in the process runtime/container, with Vercel AI Gateway supplied through Codex provider config. Cloudflare remains a thin coordinator.

## Required Behavior

- Hosted runtime consumes Codex-only assistant config.
- Hosted runtime can map:
  - `HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway`
  - `HOSTED_ASSISTANT_MODEL=gpt-5.5`
  - `HOSTED_ASSISTANT_REASONING_EFFORT=medium`
  - `HOSTED_ASSISTANT_SANDBOX=danger-full-access`
  - `HOSTED_ASSISTANT_APPROVAL_POLICY=never`
  - `VERCEL_AI_API_KEY`
  into Codex App Server config/child env.
- Generated Codex config uses `wire_api = "responses"`.
- Secret values are never persisted or logged. Persist/use env var names when possible.
- Codex runs in the isolated runtime child/process context, not in Cloudflare Worker supervisor code.
- Ensure `vault-cli` / `murph` remain discoverable to Codex in hosted runtime.
- Cloudflare does not learn Codex thread/turn semantics beyond process launch/status/log plumbing.
- Keep mailbox import, active-turn refresh/checkpoint, workspace checkpoint, outbox drain, and usage/log sinks intact.
- If Docker image/package setup lacks Codex CLI, add the smallest explicit install or preflight contract necessary for hosted runner image support.

## Security/Reliability Constraints

- Do not pass Worker callback signing secrets or supervisor secrets into Codex.
- Abort/timeout should terminate the runtime child/process group.
- Redact local paths, provider config, and subprocess stderr before durable logs.
- Missing Codex binary or missing `VERCEL_AI_API_KEY` should fail closed with actionable diagnostics.

## Verification

Run focused hosted checks if possible:

```sh
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir apps/cloudflare typecheck
pnpm --dir packages/assistant-runtime test -- hosted-assistant
pnpm --dir apps/cloudflare test -- hosted
```

Also run direct smoke when safe:

```sh
codex --version
codex app-server --help
```

Final message must list changed hosted env behavior, Cloudflare boundaries preserved, tests run, and any remaining integration dependency on Worker 01 or 02.
