## Goal

Remove the remaining greenfield-safe legacy read-path compatibility branches that only preserve old local or hosted stored-state formats, while keeping the still-active runtime and CLI contracts explicitly called out by the request.

## Success Criteria

- `packages/cli` assistant session parsing only accepts the canonical current schema, while current normalized output aliases remain intact.
- `packages/hosted-execution` outbox payload readers only accept the canonical current payload schema.
- `apps/cloudflare` no longer accepts the old hosted cipher and hosted user env schema aliases, while current keyring/keyId rotation behavior stays intact.
- `packages/runtime-state` hosted bundle readers only accept the canonical current bundle schema, and agent-state restores stop ignoring the old legacy-only runtime root.
- Cloudflare deploy automation only reads `CF_RUNNER_COMMIT_TIMEOUT_MS` as the deploy-time input, while the runtime worker env `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS` remains unchanged.
- Tests, fixtures, and docs that exist only to justify those removed branches are deleted or rewritten.

## Scope

- `packages/cli/src/assistant-cli-contracts.ts`
- Targeted CLI assistant tests/fixtures that still construct the removed legacy session shape
- `packages/hosted-execution/src/{dispatch-ref.ts,outbox-payload.ts}` and targeted hosted/web tests
- `apps/cloudflare/src/{crypto.ts,user-env.ts,deploy-automation.ts}` and targeted tests/docs
- `packages/runtime-state/src/{hosted-bundle.ts,hosted-bundles.ts}` and targeted tests
- Narrow doc updates only where current wording would otherwise preserve removed compatibility

## Explicit Non-Goals

- Do not remove current normalized assistant session output aliases (`providerBinding` plus top-level `providerSessionId` / `providerState`).
- Do not remove hosted `agentState` bundle slot support.
- Do not remove Cloudflare keyring / keyId rotation behavior.
- Do not perform the Linq recipient-phone compatibility cleanup in this pass.
- Do not perform the assistant `receipts` -> `turns` rename in this pass.

## Risks / Notes

- Several overlapping files are already dirty from other active lanes, especially in `apps/cloudflare`, `packages/runtime-state`, and CLI tests. Read live state first and preserve adjacent edits.
- Repo-wide verification may still be affected by unrelated in-flight work; record any unrelated failures precisely if they block a fully green run.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
