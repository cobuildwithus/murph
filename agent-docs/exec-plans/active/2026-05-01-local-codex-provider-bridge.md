# Local Codex Provider Bridge

Goal (incl. success criteria):
- Fix the local hosted-dev assistant failure where Worker runtime config forced a `vercel-ai-gateway` Codex model provider into the host Codex app-server bridge.
- Success means local hosted dev can run through the bridge using the host Codex config without requiring gateway credentials in the Worker/runtime env, while production hosted execution still fails closed unless the Vercel AI Gateway config is present.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Do not print or persist secrets, raw member/contact identifiers, or raw message payloads.
- Keep this scoped to local hosted dev provider selection and Codex runtime config.
- Do not weaken production hosted runtime credential requirements.

Key decisions:
- Use `HOSTED_ASSISTANT_PROVIDER=local-codex` only for the local hosted Codex bridge.
- Map `local-codex` to a Codex App Server profile with no explicit `modelProvider`, so host Codex uses its own configured provider.
- Require the local app-server proxy URL/token for `local-codex`; it must not be valid in production without the bridge.
- Treat `local-codex` as an assistant runtime config provider for env forwarding; otherwise the Worker strips the provider before the container starts.

State:
- in_progress

Done:
- Root-caused `ASSISTANT_CODEX_FAILED` to host Codex rejecting `modelProvider=vercel-ai-gateway`.
- Confirmed host Codex succeeds when no model provider override is passed.
- Found second failure boundary in live local smoke: `HOSTED_ASSISTANT_PROVIDER=local-codex` was present on Worker vars but stripped from forwarded runner env, causing `HOSTED_ASSISTANT_CONFIG_INVALID` in the container.
- Patched local provider forwarding and rebuilt `.deploy/runner-bundle`.
- Restarted `pnpm dev`; local hosted dev is ready on localhost and waiting for a fresh Linq webhook.

Now:
- Validate the next fresh inbound text through the corrected container path.

Next:
- If plain text succeeds, send an audio/PDF test and inspect parser/import logs.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the next text webhook will arrive at the current local stack; no post-restart inbound has hit local yet.

Working set (files/ids/commands):
- `scripts/dev-hosted-local/stack.ts`
- `scripts/dev-hosted-local/stack.test.ts`
- `scripts/dev-hosted-local/environment.ts`
- `scripts/dev-hosted-local/environment.test.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/operator-config/test/hosted-assistant-bootstrap.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/src/hosted-runtime/launch-spec.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `apps/cloudflare/test/runner-env.test.ts`
