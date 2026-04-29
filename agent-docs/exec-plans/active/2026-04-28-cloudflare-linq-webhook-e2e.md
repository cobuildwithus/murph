# Cloudflare Hosted Messaging E2E

Status: active
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Find and land the narrowest fix for local Cloudflare hosted messaging E2E failures across Linq webhook and Telegram first-contact suites.
- Success means the focused Linq webhook and Telegram first-contact local E2E failures pass, the aggregate local E2E failure is addressed or credibly narrowed to an unrelated remaining failure, and any directly related hosted runner Docker/Codex CLI smoke gap is fixed or reported.

## Success criteria

- Root cause is identified from test logs and code evidence.
- Narrow production or harness patch lands only in directly necessary files.
- Focused Linq webhook E2E rerun passes.
- `pnpm --dir apps/cloudflare test:e2e:local` is rerun or any remaining failure is documented as unrelated.
- Typecheck and required scoped verification are run unless blocked by unrelated dirty-tree failures.

## Scope

- In scope:
  - `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
  - `apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts`
  - Direct hosted-local test helpers and logs for the Linq webhook suite
  - Shared hosted execution/reply production code if the cross-channel failure proves a common bug
  - Direct Cloudflare runner/container/runtime code required to fix the failing path
  - Direct assistant-runtime code only if the hosted-local failure proves a runtime bug
  - Hosted runner container/Docker Codex CLI install and `codex app-server --help` smoke only if directly missing from the deployed/e2e path
- Out of scope:
  - Hosted web UI and Health Commons edits
  - Broad hosted runtime hard-cut migrations
  - Provider copy/prompt changes
  - Unrelated Cloudflare E2E failures outside the hosted messaging reply path

## Constraints

- Preserve unrelated dirty and staged work in the shared checkout.
- Do not expose secrets, raw env, direct personal identifiers, local account names, or home paths in committed files or handoff.
- Keep logs privacy-bounded and synthetic.
- Do not create or use another git worktree.

## Risks and mitigations

1. Risk: The failing file overlaps an active Linq message-cleanup row.
   Mitigation: Read the active plan, scope any edits to the current failure, and avoid broad cleanup semantics.
2. Risk: E2E timeouts hide the first real assertion failure.
   Mitigation: Reproduce focused tests first, inspect generated logs, and add narrower proof before rerunning the aggregate.
3. Risk: Docker/runner smoke changes could widen into deploy behavior.
   Mitigation: Only patch if inspection shows the production runner image lacks required Codex CLI/app-server coverage directly used by hosted execution.

## Tasks

1. Inspect existing focused E2E logs and test code.
2. Reproduce the focused Linq webhook and Telegram first-contact local E2E failures.
3. Trace the failing webhook, rapid context, metadata-only voice memo, and Telegram reply/context paths.
4. Patch the narrow root cause.
5. Run focused unit/E2E proof and aggregate local E2E.
6. Run required audits/verification and close with a scoped commit if safe.

## Decisions

- Spawned a read-only xhigh Codex subagent to inspect the Linq webhook failing suite because the aggregate local E2E was already reported red.
- After additional aggregate output showed Telegram reply/context failures too, expanded analysis to the shared hosted execution/reply path and spawned a second read-only xhigh pass for the cross-channel failure.
- Root cause: hosted-local E2E still queued HTTP assistant-provider stub responses, but the Codex app-server hard cut no longer called that HTTP stub. First-contact notification failures were skipped by policy after typing started, so the tests saw typing drains without a reply.
- Fix: add an E2E-only Codex app-server shim installed inside `CODEX_HOME/bin` by hosted Codex runtime setup when the local stub base URL is forwarded, plus Cloudflare local-dev forwarding/loopback rewrite for that stub URL.
- The E2E-only stub URL is restricted to local hostnames and is only present in hosted-local test helper env, not production deploy vars.
- A second local-only failure was Wrangler deleting duplicate `cloudflare-dev/runnercontainer:*` tags when concurrent hosted-local stacks built byte-identical images. The local runner Dockerfile now accepts a per-stack build id label through Wrangler `image_vars`, so concurrent dev images get distinct image IDs.
- The Linq first-contact harness assertion now matches the Codex app-server hard cut: immediate Linq replies use Responses API calls through the app-server shim. Stub mode also clears direct provider API key env values from the scenario overlay so local shell secrets do not leak into hosted-local assertions.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
  - `pnpm --dir apps/cloudflare test:e2e:telegram:local`
  - `pnpm --dir apps/cloudflare test:e2e:local`
  - `pnpm --dir apps/cloudflare typecheck`
  - Additional focused Vitest/package checks depending on touched files
- Expected outcomes:
  - Focused Linq webhook and Telegram E2E paths are green after the fix.
  - Any broader red check is tied to an unrelated pre-existing target before handoff.

## Results

- Passed:
  - `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-codex-config.test.ts --no-coverage`
  - `pnpm --filter @murphai/assistant-engine exec vitest run test/assistant-cli-access.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/runner-env.test.ts --no-coverage`
  - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
  - `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
  - `pnpm --dir apps/cloudflare test:e2e:telegram:local`
  - `pnpm --dir apps/cloudflare test:e2e:hosted-local`
  - `pnpm --dir apps/cloudflare test:e2e:workers:local`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --filter @murphai/assistant-engine typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm typecheck`
  - `git diff --check`
