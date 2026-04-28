# Worker 01: Operator Config Codex-Only

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; you may spawn your own focused subagents for bounded exploration or review. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `ARCHITECTURE.md`
- `agent-docs/operations/verification-and-runtime.md`

## Ownership

You own operator configuration and contracts for the Codex-only assistant runtime:

- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/operator-config/src/assistant/target-runtime.ts`
- `packages/operator-config/src/assistant-backend.ts`
- `packages/operator-config/src/assistant/hosted-config.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/operator-config/src/hosted-assistant-config-constants.ts`
- `packages/operator-config/src/setup-cli-contracts.ts`
- directly coupled `packages/operator-config/test/**` only when required for typecheck or focused proof

Avoid editing assistant-engine, CLI command implementation, hosted-runtime implementation, or package manifests unless you are fixing a compile edge that no other worker owns.

## Goal

Make Codex App Server the only active assistant runtime target at the operator-config layer.

This is a greenfield hard cut. Existing OpenAI-compatible assistant configs/sessions do not need migration. They may parse only to fail closed with a clear unsupported/reconfigure-Codex error.

## Required Behavior

- Active assistant provider values should collapse to Codex-only.
- Active runtime execution driver should be `codex-app-server`.
- Active resume kind should be Codex thread resume.
- Add or preserve a Codex `modelProvider` field so Vercel AI Gateway can be represented as a Codex model provider.
- Hosted config should accept:
  - `HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway`
  - `HOSTED_ASSISTANT_MODEL=gpt-5.5`
  - `HOSTED_ASSISTANT_REASONING_EFFORT=medium`
  - `HOSTED_ASSISTANT_APPROVAL_POLICY=never`
  - `HOSTED_ASSISTANT_SANDBOX=danger-full-access`
  - `VERCEL_AI_API_KEY` as the provider secret env var
- Hosted config should resolve that to Codex config, not a Murph OpenAI-compatible provider.
- Remove active `responses` and `openai-compatible` runtime behavior.
- Remove ZDR/gateway-only/web-search/provider-header request shaping from assistant runtime config unless it is now a Codex config field.
- Keep secret values out of persisted config. Persist env var names only.

## Expected Codex Provider Shape

The runtime should be able to derive config equivalent to:

```toml
model = "gpt-5.5"
model_provider = "vercel-ai-gateway"
model_reasoning_effort = "medium"

[model_providers.vercel-ai-gateway]
name = "Vercel AI Gateway"
base_url = "https://ai-gateway.vercel.sh/v1"
env_key = "VERCEL_AI_API_KEY"
wire_api = "responses"
```

You do not need to write the Codex config file yourself if that belongs to hosted-runtime. Your job is to make the typed config contract expose the necessary values and stop exposing the old AI SDK runtime as executable.

## Deletion Bias

Prefer deleting active OpenAI-compatible branches over compatibility shims. Keep only minimal legacy parse/error code if it prevents crashes while old files are encountered.

## Verification

Run the narrowest useful checks for your lane, such as:

```sh
pnpm --dir packages/operator-config typecheck
pnpm --dir packages/operator-config test -- assistant
```

If commands fail because other workers are mid-edit, report the exact errors and likely owner. Your final message must list changed files and any remaining cross-worker dependencies.
