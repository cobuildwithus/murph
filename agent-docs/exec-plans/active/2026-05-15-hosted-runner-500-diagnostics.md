## Goal

Diagnose production hosted runner HTTP 500 failures by surfacing safe,
metadata-only child-process failure details, container wake state, and hosted
runtime phase boundaries.

## Constraints

- Do not log raw mailbox payloads, prompts, transcripts, stdout/stderr text,
  local paths, account ids, user ids, secrets, or provider responses.
- Keep diagnostic logs metadata-only and redacted.
- Behavior changes after diagnosis must be scoped to runner liveness
  reconciliation; avoid broad container lifecycle rewrites.
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
6. Add child-bootstrap diagnostics for pre-runtime exits: wake-ready state,
   first completion kind, tail line counts, and fixed-vocabulary tail markers.
7. Run targeted verification, security/privacy audit, final review, deploy, and
   inspect new production evidence.
8. Patch the diagnosed stale active-runtime/write-fence path so unconfirmed
   container liveness can be replaced after the startup grace window, and keep
   alarm-started local runtime work attached until the local drive settles.

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
- `pnpm --dir apps/cloudflare test:node -- node-runner-isolated.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after child-bootstrap marker diagnostics.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-container.test.ts` passed after child-bootstrap marker diagnostics.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm.test.ts` passed
  after stale active-runtime replacement and alarm lifetime regressions.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed after the diagnosed runner liveness fix.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after child runtime failure classification.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts` passed after the first child runtime classifier patch; a later rerun after receiver allowlist tightening/status assertions was interrupted by the user before completion.
- `pnpm --dir apps/cloudflare typecheck` passed after receiver allowlist tightening/status assertions.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after route-level HTTP operation classification.
- `pnpm --dir apps/cloudflare typecheck` passed after route-level HTTP operation classification.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/runner-container.test.ts` passed after route-level HTTP operation classification.

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
- Child-process diagnostics now include wake-ready state, first completion kind,
  stdout/stderr line counts, and fixed-vocabulary marker codes; container and
  Worker boundaries allowlist marker/completion values before logging them.
- Production evidence showed mailbox ingestion succeeded for the newly messaged
  user while the hosted workspace imported conversation sequence stayed behind;
  the remaining blocker is runner progress wedged behind an active
  runtime/write fence whose container liveness is unconfirmed.
- Runner liveness reconciliation now preserves the startup grace window for
  fresh fences, but replaces stale active runtime fences after
  start-required/active-child-rejected/container RPC error/container RPC timeout.
- Alarm-started local drives now remain attached until the invocation settles,
  preventing cold-start work from depending only on detached waitUntil state.
- Production after the stale-fence deploy now starts replacement runner work and
  reaches a prepared child, but the child exits with a child-result failure
  before any visible hosted runtime phase boundary.
- Recent production DB state still shows the target workspace at version 1949,
  conversation mailbox sequence 712, and imported conversation sequence 704.
- Child runtime failures now carry a fixed-vocabulary runtime stage/failure
  tuple through the child result, container entrypoint response, and
  RunnerContainer failure log so the next deploy can separate workspace read,
  mailbox decode, stale authority, config, and runtime-in-process failures
  without exposing free-form child details.
- Production after the child runtime classifier deploy showed the child reaches
  `runtime.in-process` and fails with HTTP 404/`invalid_request`, but the
  parent-visible classifier was still too coarse to name the exact internal
  control-plane operation.
- Child runtime HTTP diagnostics now add a fixed-vocabulary
  `childRuntimeHttpOperation` beside the coarse failure kind, so the next
  production attempt can distinguish workspace read, mailbox fetch, checkpoint,
  runtime-log write, and adjacent internal calls without logging request bodies,
  response bodies, paths, user ids, or free-form child output.
