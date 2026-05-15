## Goal

Diagnose production hosted runner HTTP 500 failures by surfacing safe,
metadata-only child-process failure details, container wake state, and hosted
runtime phase boundaries.

## Constraints

- Do not log raw mailbox payloads, prompts, transcripts, stdout/stderr text,
  local paths, account ids, user ids, secrets, or provider responses.
- Keep the patch observability-only; do not change runner scheduling,
  checkpointing, retry, or container teardown behavior in this diagnostic
  slice.
- Preserve overlapping hosted runner work and unrelated dirty files.

## Plan

1. Inspect the existing runner/container error payload flow and identify the
   lowest-risk redacted summary fields.
2. Add compact child-process/runner-response diagnostic fields to the
   metadata-only RunnerContainer failure details.
3. Add container entrypoint logs for runtime-wake handling and child wake-ready
   registration.
4. Add hosted runtime phase-boundary logs for workspace read, restore, mailbox
   import, inbox sidecar, CLI bridge, foreground pass, checkpoint, and return.
5. Add focused tests proving useful metadata is logged without tail text or
   sensitive free-form detail.
6. Run targeted verification, security/privacy audit, final review, deploy, and
   inspect new production evidence.

## Verification

- `pnpm --dir apps/cloudflare test:node -- runner-container.test.ts` passed
  before scope expanded.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts` passed
  before scope expanded.
- `pnpm --dir apps/cloudflare test:node -- container-entrypoint.test.ts runner-container.test.ts` passed after privacy hardening.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed after privacy hardening.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed after privacy hardening.
- `pnpm --dir apps/cloudflare test:node -- runner-container.test.ts container-entrypoint.test.ts` passed after non-JSON runner response hardening.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed after non-JSON runner response hardening.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed after non-JSON runner response hardening.
- `pnpm --dir apps/cloudflare test:node -- runner-container.test.ts container-entrypoint.test.ts` passed after JSON runner detail metadata hardening and configuration-error summary cleanup.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed after JSON runner detail metadata hardening and configuration-error summary cleanup.

## State

- RunnerContainer diagnostic metadata implementation and scoped verification
  complete.
- Container wake-state and hosted runtime phase-boundary diagnostics implemented
  and verified.
- Runtime failure logs and container entrypoint failure payloads now expose only
  metadata/presence summaries, not raw error messages, stack previews, or
  child stdout/stderr tails.
- Non-JSON runner error responses now omit raw body previews and carry only
  response metadata.
- JSON runner error details are reduced to presence/shape metadata, safe codes,
  safe statuses, and child-process metadata flags.
- Awaiting final audits, deploy, and production evidence.
