# Wire hosted-local Linq webhook through Cloudflare tunnel

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Make `pnpm dev`/`hosted-local up` optionally bring the local hosted Linq webhook online through a Cloudflare Tunnel and register the Linq webhook target for the current local stack.

## Success criteria

- Hosted-local dev can derive a public Linq webhook target from an explicit env override or a local cloudflared config.
- When configured, the harness starts a managed `cloudflared` process, sets hosted onboarding public links to the tunnel origin, and registers the Linq `message.received` webhook subscription through the existing Linq API helper.
- Missing optional tunnel config does not break ordinary `pnpm dev`; explicit Linq tunnel setup failures fail with actionable errors.
- Local output and state do not print secrets, raw tokens, local home paths, or personal identifiers.

## Scope

- In scope:
  - `scripts/dev-hosted-local/**` config/environment/stack wiring.
  - Direct hosted-local harness tests and docs for the new env knobs.
  - Repo-tools Vitest aliasing needed for the new public operator-config subpath import.
  - Reuse the existing Linq API helper rather than adding a second client.
- Out of scope:
  - Changing hosted production Linq ingress semantics.
  - Changing Linq signature verification or persisted webhook receipt behavior.
  - Committing local tunnel config files or live secrets.

## Constraints

- Technical constraints:
  - Do not hard-code machine-local tunnel ids, hostnames, credentials, or local paths.
  - Keep `LINQ_WEBHOOK_SECRET` ingress-only and never forward it into hosted execution runtime.
  - Do not import sibling package internals; use declared package entrypoints.
- Product/process constraints:
  - Preserve unrelated dirty work in active hosted Linq and Cloudflare rows.
  - Follow high-risk runtime/external-surface verification and audit workflow.

## Risks and mitigations

1. Risk: dev startup could silently create a Linq subscription that signs with a different secret than the local webhook expects.
   Mitigation: compare any returned signing secret to local `LINQ_WEBHOOK_SECRET` and fail with an actionable message on mismatch.
2. Risk: an absent local tunnel config could break ordinary dev startup.
   Mitigation: skip when no explicit tunnel URL/config is provided; fail only when the operator explicitly requests Linq tunnel setup.
3. Risk: logs or state could leak tokens, phone numbers, or local machine paths.
   Mitigation: report only counts/target URLs, rely on existing state redaction, and avoid writing secrets to docs/tests.
4. Risk: repeated dev starts could duplicate provider webhook subscriptions.
   Mitigation: cache successful local registration fingerprints under ignored `.tmp/` state.
5. Risk: a shared cloudflared config could register the wrong public hostname.
   Mitigation: require the selected ingress hostname to route to the configured local hosted-web port.

## Tasks

1. Map existing hosted-local web/worker env override and Linq helper seams.
2. Add Linq tunnel target resolution and managed cloudflared process wiring.
3. Register the webhook subscription after local web/tunnel readiness when configured.
4. Add focused tests for public URL derivation, disabled/missing config behavior, registration payloads, and secret mismatch failures.
5. Run focused verification, required audit passes, and scoped commit.

## Decisions

- Use env/config-driven tunnel setup instead of committing the developer-specific tunnel hostname.
- Use an explicit public endpoint/origin override when supplied, otherwise derive from the local cloudflared config hostname.

## Verification

- Passed:
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/dev-hosted-local/config.test.ts scripts/hosted-local.test.ts scripts/dev-hosted-local/linq-webhook-tunnel.test.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts --no-coverage apps/cloudflare/test/run-hosted-local-e2e.test.ts`
  - `pnpm hosted-local --help`
  - `pnpm exec tsc -p tsconfig.tools.json --pretty false`
  - `git diff --check`
- Audits:
  - Security/privacy review found no hard-coded tunnel hostnames or raw secrets; medium findings were fixed by narrowing Linq registration env, validating cloudflared ingress service, and passing repo-relative config paths to `cloudflared`.
  - Finish review findings were fixed by disabling Linq tunnel registration in E2E defaults, caching successful local registrations, and rejecting query/hash values before URL normalization mutates the target.
- Blocked/unrelated:
  - `pnpm typecheck` gets through the repo tools typecheck for this change, then fails in dirty `packages/query` browser-replica metric point work outside this plan.
  - `pnpm test:repo-tools` now fails only in `scripts/research-init.test.ts` on a missing Health Commons protocol zip-entry expectation outside this plan.
- Not run:
  - Live Linq registration against the current tunnel, to avoid mutating the Linq webhook subscription outside a user-triggered `pnpm dev` session.
Completed: 2026-05-02
