Goal (incl. success criteria):
- Make the hosted cold-start latency breakdown queryable over time so we can target ≥3s cuts, WITHOUT adding any latency to the foreground/reply path.
- Add a single versioned `phase_breakdown_json` jsonb column to `hosted_ingress_latency_trace` carrying numeric/boolean sub-durations only:
  - restore: per-step ms (size_guard, data_key_unwrap, scratch_prepare, presign_get, object_fetch) + decrypt/extract split of archive_restore + encrypted/plain bytes
  - boot: nodeStartupMs (cold-only) + restoreWasCold boolean
  - provider: turnLockWaitMs, sessionResolveMs, promptBuildMs, admissionMs, preProviderSetupMs
- Success: the new data lands via the ALREADY-FIRING best-effort POSTs (assistant_input_staged, provider_started) and the existing trace upsert — zero new requests, zero new awaits, no I/O on the reply path; parser is the secret-safety trust boundary (numbers/booleans only); typecheck + owner coverage green.

Constraints/Assumptions:
- ABSOLUTE: instrumentation must not add latency. Measurements are in-memory Date.now() attached to objects already constructed and passed along; all sends remain `void record().catch()`. Pre-Node Cloudflare provisioning genuinely cannot ride an existing channel and stays in worker logs (readinessLatencyMs/startMode) — not forced into the DB.
- Secret-safe: only ms/bytes/booleans enter the JSON; no ids/tokens/paths/urls. Parser rejects any non-numeric/non-boolean leaf and unknown keys.
- Honor active COORDINATION_LEDGER destroy-timeout lane: boot timing is additive in container-entrypoint.ts only; do NOT reorganize runner-container.ts ensureContainerReady/withLifecycleLock.
- No new POST/route/DB write; reuse the existing assistant_input_staged + provider_started channels and the recordHostedIngress* upserts.

Key decisions:
- Storage shape B: one versioned `phase_breakdown_json` jsonb column with schemaVersion seam, not N typed columns — minimal migration/plumbing surface for heterogeneous, growing sub-durations from 3 processes; queryable via jsonb operators for p50/p95 ops rollups.
- Restore timings returned in-memory from restoreWorkspaceSnapshot (port already may return a value) up through workspace-restore.ts result → hosted-runtime.ts milestone bag → assistant_input_staged POST.
- Provider split is in-memory only; rides provider_started POST.
- Store shallow-merges sub-objects (restore/boot from staged; provider from provider_started), preserving schemaVersion and existing-value idempotency.

State:
- In progress.

Done:
- Cold-path data captured from prod (cold ~10-15s: boot ~5s, restore ~3-3.5s, mailbox ~1.5s, provider ~2.7s; warm ~3.3s).
- Instrumentation audit: restore already step-timed (worker logs only, decrypt/extract lumped, no bytes); boot has only readinessLatencyMs total; provider preProviderSetupMs lumped; all ephemeral.
- Zero-latency plumbing plan with exact file:line and channel-reuse proof per datum.

Now:
- Implement migration + schema + contract/parser + restore return seam + boot split + provider split + store merge.

Next:
- typecheck + scoped owner tests + migration validation; required audits (security-privacy, deep-review, coverage-write, task-finish-review); finish-task; PR.

DEPLOYMENT CONCERNS:
- Deploy apps/web (new migration + new latency parser) BEFORE the apps/cloudflare runtime build that emits phaseBreakdown. The parser added here drops an unrecognized/malformed phaseBreakdown leniently, but the ALREADY-DEPLOYED old web parser is strict-reject: a new runtime emitting phaseBreakdown to an old web would have its whole latency event rejected (telemetry loss only; best-effort sends, no foreground/correctness impact). Deploying web first removes the skew window. Old runtime -> new web is always safe (no field; column stays NULL).
- Migration is additive nullable JSONB (no default, no table rewrite) — backward-compatible.
- After the lenient-parser fix, future malformed/extra breakdown leaves drop just the breakdown instead of poisoning the core milestone event.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/prisma/migrations/<ts>_hosted_latency_phase_breakdown/migration.sql (new)
- apps/web/prisma/schema.prisma
- apps/web/src/lib/hosted-runtime-latency/store.ts
- apps/web/app/api/internal/hosted-runtime/latency/route.ts
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts
- packages/assistant-runtime/src/hosted-runtime/platform.ts
- packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts
- packages/assistant-runtime/src/hosted-runtime/maintenance.ts
- apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts
- apps/cloudflare/src/runtime-platform/diagnostics.ts
- apps/cloudflare/src/container-entrypoint.ts
- apps/cloudflare/src/hosted-workspace-invocation.ts
- packages/assistant-engine/src/assistant/local-service.ts
- matching test suites per package
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
