# Snapshot Diagnostics Secret Path

## Goal

Fix hosted workspace snapshot path fingerprint diagnostics so production
checkpoints can use the Worker log fingerprint secret without exposing the raw
secret through forwarded runtime env, platform env, user env, child process env,
logs, or persisted artifacts.

## Scope

- `apps/cloudflare/src/runner-job-transport.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/node-runner-child.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- Focused Cloudflare tests for the runner job, container parser, child bridge,
  snapshot diagnostics, and static secret invariant
- `agent-docs/SECURITY.md`

## Constraints

- Do not add `HOSTED_LOG_FINGERPRINT_SECRET` to any runtime env allowlist.
- Keep raw paths, raw secrets, user identifiers, object keys, and payloads out
  of diagnostics and tests.
- Preserve the broader hosted artifact diagnostics plan; this is only the
  review-comment fix for the secret propagation path.

## Plan

1. Pass a Worker-derived snapshot path HMAC key through runner job diagnostics.
2. Consume that explicit diagnostics key in the child workspace bridge.
3. Prove normalized runtime env cannot enable path fingerprints.
4. Run focused tests, typecheck, diff verification, required audits, and a
   scoped commit.

## Verification

- `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-job-transport.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts packages/runtime-state/src/hosted-bundles.ts agent-docs/SECURITY.md` passed.
- `git diff --check` passed.
- Latest `pnpm --dir apps/cloudflare typecheck` and `pnpm typecheck` reruns are blocked by unrelated dirty `packages/importers` wearable raw receipt edits: `BuildWearableRawIngestReceiptInput` no longer accepts `payload`, while importers source/tests still pass that property.

## State

- Implementation, focused verification, security review, coverage review, and
  finish review complete.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
