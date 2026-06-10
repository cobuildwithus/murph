Goal (incl. success criteria):
- Reduce hosted cold-start latency (message → provider start), measured ~15s on the cold path. Three layers in one PR:
  1. Remove the linq message prewarm vertical slice end to end (proven prod no-op).
  2. Raise the runner idle TTL so back-to-back texts reuse a warm container instead of cold-booting (most texts are cold today because the container idle-destroys within minutes).
  3. DEFERRED. Feasibility probe proved the restore→Codex path is inherently serial: Codex cwd IS the restored vault root and cwd is part of the warm launch identity (`00-invariants.md:50`), and mailbox import writes into the restored vault. No safe overlap seam exists. The only remaining lever is making R2 snapshot restore itself faster — a separate L-sized effort, deferred per user decision (idle TTL makes cold restore rare; measure before optimizing).
- Success means: no `prewarm` runtime surface remains (the unrelated Codex OpenAI-cache diagnostic kind `"prewarm"` in `runner-egress-intercept.ts` stays); idle TTL raised via the wrangler vars surface; #3 either landed with proof or explicitly deferred with the serial-path evidence; typecheck and owner coverage pass; the real wake path behavior is unchanged.

Constraints/Assumptions:
- Production evidence (2026-06-09/10): every deployed prewarm invocation returned `runtime_prewarm_accepted` with `action: "already_running"` via the `writeFence` early-exit, because the webhook wake handoff reaches the DO before the post-response prewarm hint. The prewarm never touched the container; cold-start totals are unchanged (14.8–18s). Removal is behavior-neutral.
- The real wake path (`ensureReadyForProcessing` → `ensureContainerReady`) must be preserved exactly; only prewarm entry points and prewarm-only helpers are deleted.
- Overlapping active ledger rows touch `apps/cloudflare/src/runner-container.ts` (destroy-timeout triage) and `apps/web/src/lib/hosted-onboarding/webhook-service.ts` (ingress wake repair); keep edits surgically scoped to prewarm symbols and do not reorganize surrounding code.

Key decisions:
- Full vertical deletion instead of fixing the fence gate or hint ordering: even with perfect ordering the hint leads the real wake by ~1s against a ~6.5s boot, so the feature cannot deliver meaningful latency wins on this path.
- Keep `RunnerContainerReadinessOptions.failureCleanup` only if still used by non-prewarm callers; otherwise remove it with the slice.

State:
- In progress.

Done:
- Production no-op proof captured (Vercel timing logs, DO code path, container lifecycle logs).
- Full reference map of prewarm symbols across owners.
- Prewarm slice deleted (24 files, -1280 lines). Typecheck green; scoped owner tests green.
- Completion audits on the deletion: security-privacy CLEAN, deep-review 0 findings (deploy-skew safe both directions), simplify 1 low finding (`lifecycleLockPendingCount` now write-only dead state) consciously DEFERRED to the active destroy-timeout lane that owns `withLifecycleLock`.
- #1 idle TTL: `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS=1200000` added to `apps/cloudflare/wrangler.jsonc` vars (20 min), consistent with sibling timeout vars; default constant left at 300_000 to avoid churning default-behavior tests.
- #2 feasibility probe complete: restore→Codex inherently serial; #2 deferred (see Goal).

Now:
- coverage-write + task-finish-review over the combined diff (removal + idle TTL).

Next:
- finish-task commit; push; PR. DEPLOYMENT CONCERNS: prewarm removal is deploy-order-agnostic per deep-review; idle TTL is worker-config only (no code/runtime contract change).

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- packages/cloudflare-hosted-control/src/routes.ts
- packages/cloudflare-hosted-control/src/client.ts
- packages/cloudflare-hosted-control/test/routes.test.ts
- packages/cloudflare-hosted-control/test/client.test.ts
- packages/hosted-execution/src/orchestration-control.ts
- packages/hosted-execution/src/parsers/orchestration-control.ts
- packages/hosted-execution/src/parsers.ts
- packages/hosted-execution/src/contracts.ts
- packages/hosted-execution/src/observability.ts
- packages/hosted-execution/test/hosted-orchestration-control.test.ts
- apps/cloudflare/src/worker/route-handlers/runtime-control.ts
- apps/cloudflare/src/worker-routes/shared.ts
- apps/cloudflare/src/worker/user-runner-durable-object.ts
- apps/cloudflare/src/user-runner/hosted-user-runner.ts
- apps/cloudflare/src/user-runner/runtime-processing-controller.ts
- apps/cloudflare/src/user-runner/runtime-processing-responses.ts
- apps/cloudflare/src/runner-container.ts
- apps/cloudflare/test/index.test.ts
- apps/cloudflare/test/runner-container.test.ts
- apps/cloudflare/test/user-runner-alarm.test.ts
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
