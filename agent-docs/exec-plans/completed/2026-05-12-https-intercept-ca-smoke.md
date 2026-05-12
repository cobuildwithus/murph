Goal (incl. success criteria):
- Close the hosted runner HTTPS-interception CA risk by adding an opt-in deployed-container smoke that exercises the real OpenAI/Codex egress path through Cloudflare Container HTTPS interception.
- Success means hosted Codex model-provider requests carry the runner authority headers needed by the Worker intercept, deploy smoke can request a managed-container OpenAI intercept probe, and focused tests cover the new behavior without exposing provider secrets.

Constraints/Assumptions:
- Preserve unrelated working-tree edits.
- Do not expose raw secrets, local usernames, home paths, or personal identifiers.
- Keep Worker-owned provider secrets out of the child container; the child may use only the injected-credential sentinel.
- Cloudflare docs say the ephemeral intercept CA is available at `/etc/cloudflare/certs/cloudflare-containers-ca.crt` when HTTPS interception and outbound handlers are active, and runtimes that use their own CA bundle can point at that path.

Key decisions:
- Make the live OpenAI intercept smoke opt-in via deploy smoke env instead of running on every basic health smoke.
- Use the Codex native provider path for the probe so it covers the highest-risk client, not just Node fetch/curl.

State:
- Ready to close after scoped commit.

Done:
- Confirmed current deploy smoke only checks public banner, `/health`, container health, and optional status.
- Found Codex native CA handling uses `CODEX_CA_CERTIFICATE`/`SSL_CERT_FILE`, so the runner must set those in addition to curl/Node/Python CA env.
- Added hosted Codex provider `env_http_headers` for runtime authority headers and an opt-in managed-container Codex/OpenAI intercept smoke path.
- Hardened OpenAI provider-secret injection to require the same runtime write fence as Linq, Telegram, and WhatsApp, and routed the OpenAI deploy smoke through a short-lived smoke-user write fence.
- Kept Mapbox on the existing read-only GET allowlist because the CLI Mapbox path does not currently carry runtime authority headers.

Now:
- Close the plan and commit the scoped changes.

Next:
- Run the real deployed-container smoke before production cutover.

Open questions (UNCONFIRMED if needed):
- Live production/staging Cloudflare credentials and smoke env may not be available locally; if unavailable, handoff must call out the remaining real deployed-container smoke command.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-self-brick-e2e.test.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound/headers.ts`
- `apps/cloudflare/src/runner-outbound/write-fence.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/test/smoke-hosted-deploy.test.ts`
- `apps/cloudflare/DEPLOY.md`
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
