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
9. Add assistant input-selection and outbox metadata boundaries so production
   can distinguish "mailbox imported but no reply candidate" from provider,
   cron, and delivery failures without logging raw content or identifiers.
10. Add v2 workspace snapshot restore step diagnostics so `workspace.restore`
    failures identify the failing restore sub-step without logging object keys,
    presigned URLs, snapshot ids, user ids, file paths, hashes, or content.
11. Add tar/zstd process diagnostics for workspace snapshot archive failures:
    process label, exit code/signal, stderr byte/line counts, truncation flag,
    and fixed-vocabulary stderr markers only. Do not log stderr text.
12. Add a narrow accepted-runtime-attempt liveness handoff: Cloudflare records
    a metadata-only `runner.accepted_attempt_failed` runtime log after an
    accepted async invocation fails and its write fence is cleared; web
    durably stores that log and, under a short cooldown, sends a stateless
    `runtime_recheck_requested` Temporal signal so Temporal re-reads demand.
    The signal carries no payload and Cloudflare remains a thin runner.

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
- `pnpm --dir apps/cloudflare test:node -- runner-outbound.test.ts runner-egress-intercept.test.ts` passed after Worker-boundary web-control proxy diagnostics and review-driven privacy hardening.
- `pnpm --dir apps/cloudflare typecheck` passed after Worker-boundary web-control proxy diagnostics and review-driven privacy hardening.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound/diagnostics.ts apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-outbound.test.ts` passed after Worker-boundary web-control proxy diagnostics and review-driven privacy hardening.
- `pnpm --dir apps/web test -- hosted-onboarding-linq-dispatch.test.ts` passed after removing the silent repeated usage-limit suppression path; the command ran the full web Vitest workspace.
- `pnpm --dir apps/web typecheck` passed after removing the silent repeated usage-limit suppression path.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md` passed after removing the silent repeated usage-limit suppression path.
- `pnpm --dir apps/web test -- hosted-onboarding-linq-usage-reset-e2e.test.ts` passed after adding the service-boundary repeated usage-limit regression; the command ran the full web Vitest workspace.
- `pnpm --dir apps/web typecheck` passed after adding the service-boundary repeated usage-limit regression.
- `bash scripts/workspace-verify.sh test:diff apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md` passed after adding the service-boundary repeated usage-limit regression; `apps/web verify` completed with the pre-existing lint warnings in `device-sync/agent-session-service.ts` and the pre-existing Turbopack trace warning.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts node-runner-isolated.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after adding metadata-only runtime phase trace propagation through child, entrypoint, and RunnerContainer failure payloads.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed after adding phase ordinal/elapsed/duration metadata to hosted runtime phase boundary logs.
- `pnpm --dir apps/cloudflare typecheck` and `pnpm --dir packages/assistant-runtime typecheck` passed after simplifying phase timing state and shared phase metadata projection.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts node-runner-isolated.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after the coverage-write transport-failure test and simplify cleanup.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed after simplifying phase timing state.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts packages/assistant-runtime/src/hosted-runtime.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md` passed after the coverage-write test and simplify cleanup.
- `pnpm typecheck` passed after the coverage-write test and simplify cleanup.
- `pnpm --dir apps/cloudflare typecheck` passed after final-review phase-boundary hardening.
- `pnpm --dir packages/assistant-runtime typecheck` passed after final-review phase-boundary hardening.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts node-runner-isolated.test.ts runner-container.test.ts container-entrypoint.test.ts` passed after final-review phase-boundary hardening.
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` passed after final-review phase-boundary hardening.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/src/container-entrypoint.ts packages/assistant-runtime/src/hosted-runtime.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md` passed after final-review phase-boundary hardening.
- `pnpm typecheck` passed after final-review phase-boundary hardening.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts user-runner-alarm.test.ts` passed after adding runtime control-plane request lifecycle logs and runner retry metadata.
- `pnpm --dir apps/cloudflare typecheck` passed after adding runtime control-plane request lifecycle logs and runner retry metadata.
- `security-privacy-review` found no findings; residual diagnostic-integrity risk is limited to child-spoofed fixed-vocabulary phase metadata, not data exposure.
- `simplify` review found module-global phase timing state; replaced it with per-invocation closure state and centralized child runtime phase metadata projection.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/node-runner-isolated.test.ts` passed after artifact/web-control restore diagnostics.
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-artifacts.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` passed in `packages/assistant-runtime` after artifact 404 sanitization and open-phase failure closure.
- `pnpm --dir apps/cloudflare typecheck` passed after artifact/web-control restore diagnostics.
- `pnpm --dir packages/assistant-runtime typecheck` passed after artifact 404 sanitization and open-phase failure closure.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound.ts apps/cloudflare/src/runner-outbound/diagnostics.ts apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/node-runner-child.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/artifacts.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/node-runner-child.test.ts packages/assistant-runtime/test/hosted-runtime-artifacts.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed after artifact/web-control restore diagnostics.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts node-runner-child.test.ts runner-container.test.ts` passed after adding control-plane fetch cause metadata and artifact fetch/body boundary logs.
- `pnpm --dir apps/cloudflare typecheck` passed after adding control-plane fetch cause metadata and artifact fetch/body boundary logs.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts` passed after adding control-plane fetch cause metadata and artifact fetch/body boundary logs.
- `pnpm typecheck` passed after adding control-plane fetch cause metadata and artifact fetch/body boundary logs.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts node-runner-child.test.ts runner-container.test.ts` passed after review hardening removed raw fetch-cause text from wrapper messages and wired direct web-control abort signals into diagnostics.
- `pnpm --dir apps/cloudflare typecheck` passed after review hardening removed raw fetch-cause text from wrapper messages and wired direct web-control abort signals into diagnostics.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts` passed after review hardening removed raw fetch-cause text from wrapper messages and wired direct web-control abort signals into diagnostics.
- `pnpm typecheck` passed after review hardening removed raw fetch-cause text from wrapper messages and wired direct web-control abort signals into diagnostics.
- `pnpm --dir apps/cloudflare test:node test/runner-platform.test.ts test/runner-outbound.test.ts test/user-runner-alarm.test.ts` passed after adding runner progress, artifact upload, and artifact PUT phase logs.
- `pnpm --dir apps/cloudflare typecheck` passed after adding runner progress, artifact upload, and artifact PUT phase logs.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed after adding runner progress, artifact upload, and artifact PUT phase logs.
- `security-privacy-review` found no findings in the new runner/artifact latency logs; residual risk remains in shared structured-log sanitization and pre-existing logs outside this diff.
- `coverage-write` added a failed artifact-upload regression proving warning logs stay metadata-only and exclude raw artifact SHA, member id, lease attempt id, and response body text.
- `task-finish-review` found no correctness, invariant, privacy, or TypeScript issues. It flagged two low operational-noise notes; the plan wording was updated to clarify that artifact GET/PUT crypto context logs are intentional, and phase-boundary logs are intentionally retained to diagnose hangs before completion.
- `pnpm --dir apps/cloudflare test:node test/runner-platform.test.ts test/runner-outbound.test.ts test/user-runner-alarm.test.ts` passed after coverage-write and review updates.
- `pnpm --dir apps/cloudflare typecheck` passed after coverage-write and review updates.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md` passed after coverage-write and review updates.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-outbound.test.ts` passed after the internal authority 401 operation-classification fix.
- `pnpm --dir apps/cloudflare typecheck` passed after the internal authority 401 operation-classification fix.
- `pnpm typecheck` passed after the internal authority 401 operation-classification fix.
- `security-privacy-review` found no findings in the v2 workspace
  snapshot restore step diagnostics. Residual exposure is limited to
  intentional workspace-shape metadata: archive byte/count/compression totals
  and timing.
- `simplify` found one low issue: the restore log-details helper accepted
  arbitrary detail overrides. The helper now accepts only the concrete safe
  inputs needed by this diagnostic surface.
- `coverage-write` added a direct R2 transport-error regression proving the
  restore-step warning and adjacent upstream-fetch warning stay metadata-only
  when the thrown fetch error contains presigned URL/path/query material.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts` passed
  after the v2 workspace snapshot restore diagnostics and coverage-write
  regression.
- `pnpm --dir apps/cloudflare typecheck` passed after the v2 workspace
  snapshot restore diagnostics and coverage-write regression.
- `git diff --check -- apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the v2 workspace snapshot restore diagnostics and coverage-write regression.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the v2 workspace snapshot restore diagnostics and coverage-write regression.
- `pnpm typecheck` passed after the v2 workspace snapshot restore
  diagnostics and coverage-write regression.
- `task-finish-review` found one medium adjacent-log gap: workspace snapshot
  unwrap/presign non-OK upstream warnings still logged the raw
  snapshot-id-bearing route path and used an error built from response text.
  Fixed by adding redacted `fetchHostedJson` log paths for workspace snapshot
  routes and logging a status-only error for non-OK upstream warnings while
  preserving thrown error behavior.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts` passed
  after the final-review adjacent-log fix.
- `pnpm --dir apps/cloudflare typecheck` passed after the final-review
  adjacent-log fix.
- `git diff --check -- apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the final-review adjacent-log fix.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the final-review adjacent-log fix.
- `pnpm typecheck` passed after the final-review adjacent-log fix.
- Final `task-finish-review` rerun found no findings. Residual gaps are
  accepted as low value for this slice: presign GET non-OK uses the same
  redacted `fetchHostedJson` path as the unwrap regression; archive-restore
  failures are covered by static inspection of the same step wrapper; thrown
  errors preserve upstream response text by design while structured logs stay
  status-only/safe metadata.
- Extra user-requested review subagents found no medium/high issues. Low
  findings were fixed: renamed the control-plane helper override to
  `redactedLogPath`, added a redacted direct workspace-snapshot-object origin
  label for transport-failure logs, updated the transport-error regression to
  reject the raw R2 origin, and tightened the coordination-ledger boundary to
  forbid snapshot/object identifiers and hashes.
- Post-fix focused verification passed again:
  `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts`,
  `pnpm --dir apps/cloudflare typecheck`, `git diff --check -- apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`,
  `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runner-platform.test.ts agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`,
  and `pnpm typecheck`.
- Post-fix final follow-up review found no findings. Residual risks: thrown
  upstream response text is still preserved for callers by design while
  structured logs stay redacted; hash redaction is covered by static inspection
  of the restore-detail helper rather than a dedicated test assertion.
- `pnpm --dir apps/cloudflare typecheck` passed after adding tar/zstd
  process-failure diagnostics.
- `pnpm --dir apps/cloudflare test:node -- runner-platform.test.ts
  node-runner-child.test.ts runner-container.test.ts` passed after adding
  tar/zstd process-failure diagnostics and the archive-restore regression.
- `git diff --check -- apps/cloudflare/src/workspace-snapshot-local.ts
  apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/node-runner-child.ts
  apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/runner-container.ts
  apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-container.test.ts
  agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md
  agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the
  tar/zstd diagnostics update.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/workspace-snapshot-local.ts
  apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/node-runner-child.ts
  apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/runner-container.ts
  apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-container.test.ts
  agent-docs/exec-plans/active/2026-05-15-hosted-runner-500-diagnostics.md
  agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed after the
  tar/zstd diagnostics update; it ran the Cloudflare verify surface.
- `pnpm --dir packages/hosted-execution test -- hosted-orchestration-control.test.ts
  hosted-runtime-control.test.ts` passed after adding the
  `runtime_recheck_requested` signal contract and accepted-attempt failure log
  event.
- `pnpm --dir packages/hosted-orchestrator-temporal test --
  hosted-user-runtime-workflow.test.ts` passed after adding the stateless
  runtime recheck signal path.
- `pnpm --dir apps/web test -- hosted-runtime-internal-routes.test.ts
  hosted-workspace-store.test.ts` passed after wiring the persisted runtime-log
  route to cooldown-throttle accepted-attempt failure rechecks.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm.test.ts` passed
  after wiring accepted async invocation failures to the metadata-only runtime
  log callback.
- `pnpm --dir packages/hosted-execution typecheck`,
  `pnpm --dir packages/hosted-orchestrator-temporal typecheck`,
  `pnpm --dir apps/web typecheck`, and `pnpm --dir apps/cloudflare typecheck`
  passed after the accepted-attempt recheck handoff.
- `security-privacy-review` found no findings in the accepted-attempt failure
  handoff. `simplify` found two low cleanup issues; both were fixed by making
  the recent-log query purpose-specific and basing the route decision on
  persisted log records. `coverage-write` added the focused store helper
  regression. `task-finish-review` found one stale helper reference, which was
  fixed before rerunning web tests and typecheck.
- `pnpm hosted-local e2e temporal-orchestration` passed after the liveness
  handoff changes.
- `pnpm typecheck` passed after post-review fixes.
- Final `bash scripts/workspace-verify.sh test:diff ...` passed after all
  accepted-attempt failure handoff and post-review fixes; it ran the diff-aware
  package, Cloudflare, and web verification surfaces.

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
- Worker-boundary web-control proxy diagnostics are being added so production
  can prove whether `web-control.worker` requests reach Cloudflare outbound
  interception, pass the Worker allowlist, and receive a non-OK response from
  hosted web without logging raw user ids, route parameters, request bodies, or
  response bodies.
- Security/privacy and final-review passes flagged raw user-id leakage in the
  adjacent open-internet passthrough log and raw method-token logging risk in
  the new diagnostics; both were fixed by logging user-id presence only and
  normalizing logged methods to a fixed vocabulary.
- The web-control allowlist and diagnostic operation classifier now share one
  policy helper so future route additions cannot drift between allowed behavior
  and log classification.
- A fresh production text reached the Linq webhook and updated active-member
  inbound tracking, but it did not append a conversation mailbox item or nudge
  the runner because the matched member is over the hosted AI usage limit and
  the usage-period notice was already marked sent. This is a distinct silent
  usage-gate branch, not a container/runtime failure.
- Repeated Linq usage-limit denials now still send the deterministic non-AI
  quota reply for each new inbound event; the usage-period notice marker is
  retained as accounting metadata but no longer controls whether the user gets
  an answer.
- A hosted Linq service-boundary e2e regression now covers the production
  failure shape: exhausted usage period, already-claimed notice marker, and a
  fresh inbound text still produce the deterministic usage-limit reply without
  appending mailbox work or nudging the runner.
- Hosted runtime phase boundaries now include ordinal, elapsed, and phase
  duration metadata. The child supervisor extracts a fixed-vocabulary bounded
  runtime phase trace from child stdout/stderr and carries only that summary
  through the entrypoint response and RunnerContainer failure logs, preserving
  the raw-output redaction boundary while exposing the last runtime phase.
- Child runtime classification now separates control-plane HTTP failures,
  invalid-JSON control-plane responses, fetch/transport failures, and
  Cloudflare RPC destroy failures by fixed failure kind and operation.
- Runtime phase timing state is invocation-local, not module-global, and phase
  metadata sanitization is shared through the child diagnostics helper before
  entrypoint or RunnerContainer logging.
- Final-review hardening treats child stdout/stderr phase logs as untrusted at
  the parent boundary: parent failure payloads now use line-order phase trace
  and a bounded supervisor-derived last-phase ordinal only, without carrying
  child-provided elapsed/duration numbers.
- Runtime control-plane calls now emit metadata-only start, response, pre-response
  failure, and invalid-JSON logs with method, safe route path, transport, origin,
  timeout, body size, status, latency, and safe error shape. These logs omit raw
  request bodies, response bodies, and raw error text.
- Runtime wake failures now log the recorded retry timestamp and delay beside
  the existing write-fence attempt metadata, so production evidence can separate
  first-attempt failure time from deliberate retry backoff.
- Production evidence from the latest incident points to cold restore/control-plane
  failure, not signup state, usage gating, or provider latency. The dominant
  child failure shape is artifact fetch during runtime-in-process restore; a
  smaller secondary shape is workspace-read HTTP 404.
- Artifact GET/PUT handling now emits metadata-only Worker-boundary completion
  logs with fixed operation, status, duration, found/authorized flags, and byte
  counts only; raw content hashes, object paths, user ids, and bodies stay out
  of logs.
- Hosted runtime artifact misses now throw a sanitized HTTP 404 error, allowing
  the child classifier to report `artifact_fetch`/`control_plane_http` instead
  of a generic runtime error with a raw artifact hash.
- Web-control non-OK responses now log only response body size/kind and safe
  JSON error code/shape, making hosted-web 404s distinguishable from HTML/text
  routing failures without logging response bodies.
- Current local incident showed `workspace.restore:fail` after data-key unwrap
  and presign GET. V2 snapshot restore now emits diagnostics at the
  snapshot-port boundary for size guard, data-key unwrap, scratch preparation,
  presign GET, object fetch, and archive restore, so the next failure exposes
  the fixed-vocabulary step that failed while preserving the raw
  snapshot/object/path redaction boundary.
- Workspace snapshot control-plane non-OK warnings now use redacted log paths
  and status/body-size metadata only, so adjacent unwrap/presign warnings do
  not leak snapshot ids or response-body text while thrown errors still keep
  their existing behavior for callers.
- Runtime phase logging now closes any still-open phase with a fail boundary
  before logging the outer runtime failure, so restore failures produce
  `workspace.restore:fail` instead of only `runtime:fail`.
- Control-plane fetch failures now carry fixed-vocabulary cause metadata through
  the runtime platform, child result, and RunnerContainer indexed logs:
  fetch cause kind/code/name, timeout, and caller/request/timeout abort flags.
- Production evidence from the current Linq incident shows one text did not
  reach hosted web ingress, while the previous text reached mailbox import and
  then failed to become an auto-reply candidate before cron/outbox work ran.
  The remaining missing boundary is assistant input staging/candidate listing
  and outbox failure classification.
- Artifact fetches now emit metadata-only start, response, body-read start,
  body-read completion, and pre-response/body-read failure boundaries with
  redacted object paths and per-platform ordinals, so the next production
  failure can separate pre-response transport failures from response/body stream
  failures without exposing artifact hashes or bodies.
- Runner progress now emits metadata-only start/completion logs with demand
  read duration, progress kind, write-fence/backoff timing, local ensure state,
  and next-alarm state. The local ensure loop also logs demand checks and
  runtime-wake handoff timing.
- Artifact uploads now emit metadata-only client-side start, write-fence header,
  response, pre-response failure, and completion boundaries with redacted object
  paths and per-platform ordinals.
- Runner-side artifact request handling now logs crypto context resolution for
  artifact GET/PUT paths. PUT handling also logs write-fence validation, request
  body read, and artifact write boundaries with duration and byte-count metadata
  only.
- Production evidence from the 2026-05-18 18:28 UTC Linq incident showed the
  primary checkpoint failure was an artifact PUT write-fence 401. Later retry
  attempts produced workspace-read 404s, which made the root failure look like a
  404 when reading only the latest child-runtime summary.
- Internal authority 401/403 errors now preserve fixed operation descriptions,
  so artifact PUT authorization failures classify as `artifact_upload` plus
  `stale_invocation_authority` instead of a generic internal request.
- Runtime write-fence validation rejection logs now add fixed reject-reason and
  match booleans so the next artifact 401 can identify the stale-fence component
  without logging attempt ids, user ids, workspace versions, paths, or bodies.
- Workspace snapshot archive restore/create/list failures now capture tar/zstd
  process metadata and thread it through runtime-platform, child-runtime, and
  RunnerContainer diagnostics without stderr text or snapshot/object/user/path
  identifiers.
- Accepted async runtime invocation failures now have a narrow liveness
  handoff: Cloudflare records only a metadata runtime log after clearing the
  failed attempt's write fence, web persists that log and applies a short
  same-user cooldown, and Temporal receives a payload-free recheck signal that
  only interrupts its wait and re-reads demand.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
