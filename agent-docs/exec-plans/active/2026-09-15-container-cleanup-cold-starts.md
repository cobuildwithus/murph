# Stop observational liveness checks from delaying container cleanup

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and invariants

Stop an otherwise idle completed container promptly after exact durable completion. Preserve foreground arrivals, actual wakes, active work, uncertain cleanup, and current conversation warmth. Investigate the remaining physical cold starts independently of scheduler-request counts.

## Owner and evidence

RunnerContainer owns lifecycle admission and its interaction generation. Ordinary synchronous active-fence reads currently increment the same generation as new work, invalidating completion cleanup. Existing deferred invocation and completion tests provide the composed reproduction boundary. Current main also contains the message-receipt idle deadline correction; preserve that contract.

## Scope and design

- Separate ordinary synchronous active-fence observation from lifecycle-affecting status/health recovery within the existing method.
- Preserve the original invocation generation; do not replace it with a fresh completion-time generation that could forget a foreground readiness arrival.
- Keep uncertainty branches coordinated, and use existing lifecycle telemetry for evidence where possible.
- Trace runtime starts, device-pass progress, retained jobs, provider errors, and canonical due dates through bounded private diagnostics. Use only synthetic cases in source and tests.
- No new scheduler, durable owner, queue, timer setting, or container size change.

## Proof and delivery

1. Add a deferred exact-active liveness regression for both completion-notification arrival orders; prove failure before the fix.
2. Preserve inactive/uncertain fence behavior, foreground readiness, stale completion, and active-child controls.
3. Run focused Cloudflare tests, typecheck, complexity and docs checks.
4. Explain cold-start causes from live evidence and identify the next scheduling correction without weakening retained-job ownership.
5. Parent review, stable pushed PR, concurrent ReviewGPT and CI, close plan, and green final-head checks.

## Deployment

Worker-only lifecycle semantics with unchanged RPC/envelope shapes; old runner images remain readable. Deploy through the normal authorized hosted path after merge. Verify matched completion-to-stop and physical starts, distinguishing actual foreground arrivals and remaining provider work. No schema migration or rollback is part of this task.

## Verification

- Both composed active-fence observation tests failed before the source correction: completion did not destroy the idle shell.
- After correction, the two focused RunnerContainer files passed all 261 tests; Cloudflare typecheck passed.
- Complexity diff passed with unchanged debt. Existing unrelated hotspots remain in wakeRuntimeObserved, ensureContainerReady, and classifyHostedRunnerContainerErrorResponse.
- Investigation identified late scheduled mailbox arrivals after initial import, plus retained continuations intentionally choosing provider cadence ahead of future history-job availability. Those paths need a separate scheduling change with composed cold-restore and canonical publication proof; shortening cleanup does not itself reduce start count.
- No member-visible behavior or provider-input change; changelog is not applicable to this internal lifecycle correction.
- Final PR review and CI pending.
