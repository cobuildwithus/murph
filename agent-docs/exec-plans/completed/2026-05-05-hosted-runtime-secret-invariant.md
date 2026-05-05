# Hosted runtime static secret invariant

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Add a hosted-runner regression test that recursively guards the runtime job
  construction and child-launch path against static secret-shaped keys in JSON
  payloads and projected child env surfaces.

## Success criteria

- The test explicitly seeds every current reasonably available hosted secret key
  name.
- The test fails on unreviewed secret-shaped keys in `runtime.forwardedEnv`,
  `runtime.userEnv`, `runtime.platformEnv`, `runtime.resolvedConfig`, child env,
  and serialized job input, while temporarily allowlisting current known
  exposures at exact paths.
- The test specifically asserts `MURPH_HOSTED_CLI_BRIDGE_TOKEN` is absent from
  every scanned runtime, job, child stdin, and child env surface.
- The denylist catches keys matching `API_KEY`, `TOKEN`, `SECRET`,
  `PRIVATE_JWK`, `PRIVATE_KEY`, `CLIENT_SECRET`, or `PASSWORD`, with a small
  allowlist that temporarily permits current exposure so future cleanup can
  shrink the set without losing invariant coverage.
- Scoped verification for the touched hosted runner tests passes.

## Scope

- In scope: hosted-runner tests around `buildHostedRunnerJobRuntimeConfig`, job
  input serialization, child stdin payload, and child env projection.
- Out of scope: changing runtime secret forwarding behavior in this pass.

## Constraints

- Technical constraints: do not alter runtime behavior yet; no real credential
  values in fixtures.
- Product/process constraints: preserve unrelated dirty Cloudflare/runtime work
  in the current checkout.

## Risks and mitigations

1. Risk: the test can become too permissive if the allowlist hides new leaks.
   Mitigation: keep allowlist centralized and named as temporary current
   exposure.
2. Risk: broad dirty worktree makes diff-aware verification noisy.
   Mitigation: use focused app/package commands for touched files where needed.

## Tasks

1. Done: inspect existing hosted runner env and child-launch tests.
2. Done: add recursive secret-key invariant helpers and cases.
3. Done: run focused test and attempted required Cloudflare verification.
4. Done: run required completion audits and address findings.
5. Now: finish the plan with a scoped commit if not blocked by overlapping dirty
   work.

## Decisions

- The allowlist starts by permitting current known exposures at exact paths so
  this pass can establish the test harness before behavior is tightened.
  `MURPH_HOSTED_CLI_BRIDGE_TOKEN` is specifically required to be absent from the
  Worker-built job/runtime/child surfaces because it is created later inside the
  invocation runtime.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts`
- Passed: `git diff --check -- apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts agent-docs/exec-plans/active/2026-05-05-hosted-runtime-secret-invariant.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked: `pnpm --dir apps/cloudflare verify` fails during existing app
  typecheck in unrelated dirty `runtime-bridge-workspace` and
  `hosted-bundles` files, before reaching the focused test.
- Security/privacy audit: one low plan-wording mismatch found and fixed.
- Final review: found missing fixture coverage for `HOSTED_LOG_FINGERPRINT_SECRET`
  and `HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON`, plus a stale
  plan decision note; both were fixed.
Completed: 2026-05-05
