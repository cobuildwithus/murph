# Murph Agent Docs Index

Automation database load, daily scheduling, and Flex retry work:
[`2026-09-21-automation-query-load.md`](exec-plans/completed/2026-09-21-automation-query-load.md).

Canonical device import preparation reuse is owned by `packages/core/README.md`;
regression proof and local measurements are tracked in
[`2026-09-21-device-import-write-cost.md`](exec-plans/completed/2026-09-21-device-import-write-cost.md).

Direct meal execution and official nutrition-source inspection are owned by
`packages/assistant-engine/skills/food-journal/SKILL.md`; focused proof is tracked in
[`2026-09-20-meal-tool-efficiency.md`](exec-plans/completed/2026-09-20-meal-tool-efficiency.md).

Active delegated-request protection during background checkpointing is owned by
`ARCHITECTURE.md`; review remediation and proof are recorded in
[`2026-09-20-background-ask-lifetime.md`](exec-plans/completed/2026-09-20-background-ask-lifetime.md).

Background assistant checkpoint timing is owned by
`agent-docs/references/hosted-runtime-protocol.md`; implementation and focused proof
are recorded in
[`2026-09-20-background-assistant-idle.md`](exec-plans/completed/2026-09-20-background-assistant-idle.md).

Replica receipt batching and its Web-first rollout are owned by
`references/hosted-postgres-runtime.md` and `../apps/cloudflare/DEPLOY.md`;
implementation proof is recorded in
[`2026-09-20-replica-batch-consumer.md`](exec-plans/completed/2026-09-20-replica-batch-consumer.md).

Runtime completion HTTP consolidation is tracked in
[`2026-09-20-edge-completion-calls.md`](exec-plans/completed/2026-09-20-edge-completion-calls.md).

Finite Codex background-boundary failure codes and early child-completion
ordering are owned by `ARCHITECTURE.md`. Focused proof and simplification are
recorded in
[`2026-09-20-background-work-diagnostics.md`](exec-plans/completed/2026-09-20-background-work-diagnostics.md).

Web runtime admission implementation and focused proof are recorded in
[`2026-09-18-web-runtime-admission.md`](exec-plans/completed/2026-09-18-web-runtime-admission.md).
Consumer-first rollout remains owned by `apps/cloudflare/DEPLOY.md`.

Simultaneous runtime latency milestone batching is owned by `agent-docs/RELIABILITY.md`;
implementation and proof are recorded in
[`2026-09-20-edge-latency-batches.md`](exec-plans/completed/2026-09-20-edge-latency-batches.md).

Deferred device webhook transfer and restored duplicate retirement are owned by
`agent-docs/RELIABILITY.md`; focused mailbox and composed runtime proof are
indexed in `agent-docs/references/testing-ci-map.md`.

Checkpointed historical scan progress, including empty-date coverage, is owned
by `agent-docs/RELIABILITY.md` and `packages/device-syncd/README.md`.

Checkpoint-aware operational stall alerts, including bounded publication time
for deferred device jobs and checkpoint-confirmed runnable cycling windows,
are specified in `agent-docs/RELIABILITY.md`.
Cycling-window correction and focused proof are recorded in
[`2026-09-20-device-cycling-alert.md`](exec-plans/completed/2026-09-20-device-cycling-alert.md).
The original productive-pass and conversation implementation is tracked in
[`2026-09-18-checkpoint-aware-stall-alerts.md`](exec-plans/completed/2026-09-18-checkpoint-aware-stall-alerts.md).

Healthy retention rechecks, observation-only cleanup health, and incomplete
provider-stream close classification are owned by `apps/cloudflare/README.md`; implementation
work is tracked in `exec-plans/completed/2026-09-18-retention-proxy-triage.md`.

The completed plain-grant 90-date group-sharing follow-up is recorded in
[`2026-09-18-group-history-plain-grants.md`](exec-plans/completed/2026-09-18-group-history-plain-grants.md).

Version-aware vault-share scope discovery is owned by
`agent-docs/product-specs/group-challenge-data-diagnostics.md`; implementation
and focused proof are tracked in
[`2026-09-20-edge-sharing-calls.md`](exec-plans/completed/2026-09-20-edge-sharing-calls.md).

Completed query rebuild phase telemetry implementation and parent validation are
recorded in
[`2026-09-17-query-rebuild-phase-telemetry.md`](exec-plans/completed/2026-09-17-query-rebuild-phase-telemetry.md).
Deployment remains blocked and not observation-ready; the live phase and
reader-before-producer contract is owned by `docs/hosted-runtime-log-database.md`.

Hosted-local pre-allocation barrier control recovery is tracked in
[`2026-09-17-runtime-test-target-routing.md`](exec-plans/active/2026-09-17-runtime-test-target-routing.md).

Hosted proxy diagnostics, timeout ownership preservation, and finite replica
conflicts are specified in `apps/cloudflare/README.md`; the implementation and
release record is
[`2026-09-17-proxy-diagnostics.md`](exec-plans/completed/2026-09-17-proxy-diagnostics.md).

Completed silent-input typing-alert classification is specified in
`agent-docs/RELIABILITY.md`; the scoped implementation and verification record is
[`2026-09-17-typing-terminal-classification.md`](exec-plans/completed/2026-09-17-typing-terminal-classification.md).

Upcoming-context sparse plan edits, canonical timing precision, bounded ledger
controls independent of source history, and disconnect invalidation are owned by
`agent-docs/product-specs/journal.md` and `ARCHITECTURE.md`.

Admission and occurrence-scoped recovery of colliding connection jobs during
retained device history retries are owned by `agent-docs/RELIABILITY.md`; the
existing mailbox claim preserves one continuation and exact job backoff across preemption and restoration.

Last verified: 2026-09-11

Bounded Junction full-history batching, exact scalar continuation, and
foreground yield are owned by `agent-docs/RELIABILITY.md`; provider and durable
service restart/retry proof lives in
`packages/device-syncd/test/junction-full-backfill-progress.test.ts`.

Device-sync sweep capacity, backlog-presence telemetry, and the optional
preflight admission budget are owned by `agent-docs/RELIABILITY.md`; the
implementation record is
[`2026-09-15-device-sweep-capacity.md`](exec-plans/completed/2026-09-15-device-sweep-capacity.md).

System-mailbox shutdown handoff is owned by `packages/assistant-runtime/README.md`;
its checkpoint/restore proof is recorded in
[`2026-09-21-device-shutdown-handoff.md`](exec-plans/completed/2026-09-21-device-shutdown-handoff.md).

Container CPU profiling implementation and synthetic verification are recorded in
[`2026-09-21-container-cpu-profiling.md`](exec-plans/completed/2026-09-21-container-cpu-profiling.md).

Experiment closeout query-cost proof is recorded in
[`2026-09-21-experiment-closeout-query-cost.md`](exec-plans/completed/2026-09-21-experiment-closeout-query-cost.md).

The completed Temporal release fixture corrections and recovery verification are recorded in
[`2026-09-17-temporal-release-recovery.md`](exec-plans/completed/2026-09-17-temporal-release-recovery.md).

Empty-source startup batching and Postgres processing summaries are owned by
`agent-docs/references/hosted-postgres-runtime.md`; warm-wake subdivisions are
owned by `agent-docs/references/hosted-runtime-protocol.md`. Implementation proof:
[`2026-09-17-runtime-latency-followup.md`](exec-plans/completed/2026-09-17-runtime-latency-followup.md).

Runtime authority lock/read consolidation is recorded in
[`2026-09-20-runtime-latency-delete-work.md`](exec-plans/active/2026-09-20-runtime-latency-delete-work.md).

Bounded runtime cleanup cadence and shared-owner safety proof are recorded in
[`2026-09-18-orphan-cleanup-throughput.md`](exec-plans/completed/2026-09-18-orphan-cleanup-throughput.md).

Runtime admission policy and single-request provider backend selection are owned
by `agent-docs/references/hosted-postgres-runtime.md` and `agent-docs/SECURITY.md`.

The completed rolling Postgres migration and production legacy namespace
retirement are recorded in
[`2026-09-15-rolling-runtime-cutover.md`](exec-plans/completed/2026-09-15-rolling-runtime-cutover.md).
The current deployment contract remains in `agent-docs/references/hosted-postgres-runtime.md`.

Hosted Responses WebSocket pass-through, handshake image eligibility, and
container-owned revocation are documented in `apps/cloudflare/README.md`,
`agent-docs/SECURITY.md`, and `agent-docs/product-specs/starter-usage.md`.
Pinned Codex/workerd reuse and fallback proof is indexed in
`agent-docs/references/testing-ci-map.md`.

Follow-up profile budget correction and maintenance replay verification are tracked
in `exec-plans/completed/2026-09-20-memory-vault-replay.md`.

Private memory selection and automatic compaction are owned by
`ARCHITECTURE.md`; focused selection, managed-seed convergence, maintenance
admission, and real-Codex fresh-conversation proof live in the assistant-engine
memory and managed-automation tests. Implementation and review evidence is
recorded in `exec-plans/completed/2026-09-20-memory-current-context.md`.

## Purpose

Deferred device hints honor their persisted retry time in wake projection and
mailbox admission. The contract is owned by `agent-docs/RELIABILITY.md`; focused
proof lives in the assistant-runtime device-hint, mailbox-state, and empty-mailbox tests.

Maximum-census runtime retirement proof is indexed in
`agent-docs/references/testing-ci-map.md`.

Native active-runtime wake transport and single-owner member-binding admission
are specified in the hosted runtime protocol reference; cold-start readiness
retains its existing owner.

The hosted runtime protocol reference also owns the shared ten-minute idle policy,
receipt-based expiry, early Ask checkpoint handoff (including mixed system pages),
and invocation-policy compatibility during staged releases.

Immediate manual meal estimation and ordinary incomplete-meal recovery are
owned by `ARCHITECTURE.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/SECURITY.md`. Their focused proof covers canonical import replay,
private notification tools, model admission, and real assistant replies.

Empty automatic meal closeout admission is owned by `ARCHITECTURE.md`;
canonical queue, scheduler, and focused real-Codex proof are indexed in
`agent-docs/references/testing-ci-map.md`.

Conversation batching uses conversation-lane adjacency while retaining increasing
causal order for effects; initial, recovered and live admission are owned by
`agent-docs/references/hosted-runtime-protocol.md` and verified by the runtime
turn-input suite. Preference mutations retain the requesting message's authority
through transport-independent accepted message refs, as described in the same
protocol owner.

Manual device refresh admission during retained history retries, one-shot
provider job creation and recovery compatibility are owned by
`agent-docs/RELIABILITY.md` and the hosted runtime protocol reference.

Verification inventory, composed diff routing, cold stale-invocation coverage and
UTC PostgreSQL connection proof are indexed in
`agent-docs/references/testing-ci-map.md`.

Local system-timer ownership and progress-based churn containment are owned by
`agent-docs/RELIABILITY.md`; automatic restart, admission and replay regressions
are indexed in `agent-docs/references/testing-ci-map.md`.

Prepared device-webhook revision rebinding and content-free transport/replan
diagnostics are owned by `agent-docs/RELIABILITY.md`; local PostgreSQL burst and
cryptographic-binding proof is indexed in `agent-docs/references/testing-ci-map.md`.

Personal Patterns usage-pause alert suppression, expiry, and checkpoint wake diagnostics are specified in
`agent-docs/RELIABILITY.md` and the hosted runtime protocol reference.

Runtime-owned terminal Linq send recovery and replacement receipt ownership
are specified by `ARCHITECTURE.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/SECURITY.md`; focused provider and PostgreSQL proof is indexed in
`agent-docs/references/testing-ci-map.md`.

Device-sync metadata priority within the existing bounded envelope is specified
by `agent-docs/RELIABILITY.md`, including finite SpO2 categories, bounded ECG
matching counts, retained validation retries, and resource completion counts;
Junction's progress keys remain provider-owned.

Runtime progress diagnostics (aggregate alerts, per-message warm/cold typing
alerts with exact-chat silence resets, answered-input completion,
contention-safe acceptance evidence,
turn-admission and provider-lifetime evidence, and code-only
first-pending evidence) are specified in
[`agent-docs/RELIABILITY.md`](RELIABILITY.md#runtime-expectations).
That owner also specifies cold-restore download transport milestones,
process-activity timing, and bounded Cloudflare/R2 request correlation.
The silence-reset follow-up is recorded in
[`2026-09-15-typing-silence-reset.md`](exec-plans/completed/2026-09-15-typing-silence-reset.md).

Automation edit schema discovery and attended progress guidance are owned by
`ARCHITECTURE.md` and `agent-docs/RELIABILITY.md`. Real Codex native-schema and
declaration preservation, independent schema/runtime structural admission parity,
versioned edits, finite weekday cron authoring, nutrition/personalization inputs,
and quick-versus-long progress proof is indexed in `agent-docs/references/testing-ci-map.md`.
`agent-docs/product-specs/bring-your-own-inference.md` owns complete custom-provider
tool-description transport and its existing byte/count bounds.

This is a directory, not a second copy of the system contracts. Start with
`AGENTS.md` and `agent-docs/operations/agent-workflow-routing.md`; open the
owners relevant to the task. A row's date is its recorded verification date,
not a guarantee that every claim was checked in this cleanup.

Generated-image retirement after hosted media expiry is owned by
`agent-docs/RELIABILITY.md`; implementation and verification are tracked in
`agent-docs/exec-plans/completed/2026-09-10-generated-image-retention-expiry-fix.md`.

Public production candidates retain SHA-scoped required checks and protected-main
ancestry admission as documented in `operations/verification-and-runtime.md`,
`references/hosted-temporal-orchestration.md`, `SECURITY.md`, and
`../apps/web/README.md`. Vercel remains the managed Git promotion owner.

Database-monitor telemetry paging requires six consecutive failed collections;
recovery withdraws unadmitted telemetry while concrete alerts and ambiguous
notification retries retain their existing guarantees. Owners are
`agent-docs/RELIABILITY.md` and `apps/cloudflare/README.md`; focused scenarios
are indexed in `agent-docs/references/testing-ci-map.md`.

The completed canary authority diagnostic plan is
[`2026-09-13-canary-authority-reason-telemetry.md`](exec-plans/completed/2026-09-13-canary-authority-reason-telemetry.md).
The canary runtime-authority and WebSocket queue-bound correction is tracked in
[`2026-09-13-canary-consent-websocket-bounds.md`](exec-plans/completed/2026-09-13-canary-consent-websocket-bounds.md).
The canary observation window follows the production checkpoint quiet window in
[`operations/live-provider-canaries.md`](operations/live-provider-canaries.md);
the shared quiet-window budget, bounded publication allowance, and workflow deadline are owned by
[`RELIABILITY.md`](RELIABILITY.md#runtime-expectations).
The earlier timing correction is tracked in
[`2026-09-13-canary-checkpoint-observation.md`](exec-plans/completed/2026-09-13-canary-checkpoint-observation.md).
The live v2 checkpoint and canonical-replica freshness correction is tracked in
[`2026-09-14-canary-replica-freshness.md`](exec-plans/completed/2026-09-14-canary-replica-freshness.md).

Startup mailbox-fetch overlap is tracked in
[`2026-09-15-mailbox-startup-batch.md`](exec-plans/completed/2026-09-15-mailbox-startup-batch.md).
Its cursor-hint, recovery and wake-invalidation contract is owned by
`agent-docs/references/hosted-runtime-protocol.md`.

Attachment turns starting before remote backup are tracked in
[`2026-09-16-attachment-fast-start.md`](exec-plans/completed/2026-09-16-attachment-fast-start.md).
Its best-effort backup, canonical-write contention retry, and inbox capture
replay contract is owned by `agent-docs/references/hosted-runtime-protocol.md`.

Foreground promotion batch reuse and completion/wake race preservation are owned
by `agent-docs/references/hosted-runtime-protocol.md`; focused admission, import
overlap, and recovery proof is indexed in `agent-docs/references/testing-ci-map.md`.
Promotion also reuses the combined mailbox response for its pre-assistant system
prefix, avoiding a second fetch after established conversation input is staged.

Active crypto-root preparation reuses one bounded metadata snapshot while
preserving locked authority revalidation; its contract is owned by
`agent-docs/RELIABILITY.md` and proof by the hosted crypto domain-root tests.

Junction SDK collection keys, uncapped preflight admission within the existing
sweep cohort, and checkpointed cadence publication with retained future jobs are
owned by `operations/device-sync-ingestion-invariants.md` and `RELIABILITY.md`.
The implementation and focused proof are recorded in
[`2026-09-14-junction-preflight-fallbacks.md`](exec-plans/completed/2026-09-14-junction-preflight-fallbacks.md).

Telegram proof creation delegates record IDs to the encrypted Better Auth adapter;
the warning regression and delivery evidence are tracked in
[`2026-09-15-telegram-auth-id.md`](exec-plans/completed/2026-09-15-telegram-auth-id.md).

The deployment unblock retaining the dormant experiment namespace is tracked in
[`2026-09-15-defer-small-namespace-retirement.md`](exec-plans/completed/2026-09-15-defer-small-namespace-retirement.md).

Silent morning Journal capture, canonical plan context, retirement of the
afternoon pass, and bounded private upcoming-context injection are owned by
`product-specs/journal.md` and `ARCHITECTURE.md`.
The reviewed implementation and verification are recorded in
[`2026-09-15-upcoming-context-review.md`](exec-plans/completed/2026-09-15-upcoming-context-review.md).
Subsequent corrections, proactive guidance, regression proof, and final review are in
[`2026-09-16-upcoming-context-corrections.md`](exec-plans/completed/2026-09-16-upcoming-context-corrections.md).

Retained device-import stall, cycling and long-backlog operator alerts are owned
by `agent-docs/RELIABILITY.md`; connection ownership in diagnostic events is
specified in `docs/hosted-runtime-log-database.md`. Classifier, bounded-reader and PostgreSQL proof
are indexed in `agent-docs/references/testing-ci-map.md`.

SpO2/ECG validation telemetry, retained retry ownership, and review evidence
for preserving collection scope are recorded in
[`2026-09-16-junction-validation-pr.md`](exec-plans/completed/2026-09-16-junction-validation-pr.md).

The OTP reauthentication cache correction and focused cryptographic regression
proof are recorded in
[`2026-09-17-reauth-otp-cache.md`](exec-plans/completed/2026-09-17-reauth-otp-cache.md).

Live canary cadence and executed-proof requirements are owned by
[`operations/live-provider-canaries.md`](operations/live-provider-canaries.md):
Linq every six hours, native platforms every twelve hours, and Garmin,
real-model, and live Stripe proof daily.

The iOS production-revision canary correction is tracked in
[`2026-09-18-ios-canary-production.md`](exec-plans/completed/2026-09-18-ios-canary-production.md).

The production-promotion continuity correction for the native iOS health canary
is recorded in [`2026-09-18-ios-canary-deployment-continuity.md`](exec-plans/completed/2026-09-18-ios-canary-deployment-continuity.md).

## Canonical Docs

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, public package posture, local/hosted runtime tiers, and verification entrypoints. | Current repository state | High | 2026-05-02 |
| `ARCHITECTURE.md` | Current runtime architecture, including channel-welcome reader compatibility and bounded contextual greetings, hosted media identity, reference-only preservation, checkpoint cleanup, receipt recovery, clinical document enrichment, retired member shell-hint transport, and separate founder-email eligibility alongside Murph channel greetings. | Current runtime architecture | High | 2026-09-12 |
| `agent-docs/ARCHITECTURE_GUIDANCE.md` | Architecture planning guidance. | Architecture planning guidance | High | 2026-08-24 |
| `PRODUCT.md` | Strategic design context: register, users, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system. | Visual design system | High | 2026-07-22 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, package-boundary hygiene notes, and hosted ownership baseline. | Current architectural baseline | High | 2026-05-13 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and cross-cutting invariants. | Canonical vault interface decisions | High | 2026-07-20 |
| `docs/contracts/06-hosted-workspace-file-count.md` | Hosted workspace checkpoint/restore and canonical receipt media recovery contract. | Hosted workspace checkpoint/restore contract | High | 2026-09-10 |
| `docs/device-sync-hosted-control-plane.md` | Current hosted control-plane direction for device sync. | Device-sync architecture direction | Medium | 2026-09-08 |
| `docs/device-provider-contribution-kit.md` | Maintainer guide for adding wearable providers. | Provider contribution workflow | Medium | 2026-05-13 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations. | Device-provider normalization planning | Medium | 2026-07-14 |
| `docs/hosted-auth-migration.md` | Staged Privy removal, encrypted Better Auth backend, Ops import, approved credential changes, saved-key recovery, shared account connections, temporary Ops unused-signup cleanup, session/native continuity, conditional iPhone update policy and retirement gates. | Hosted auth migration rollout | High | 2026-09-10 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam and future rotation constraints. | Hosted contact-privacy rotation seam | Medium | 2026-07-16 |
| `docs/hosted-linq-db-home-lines-migration.md` | Database-backed Linq home-line assignment, provider inventory freshness, and bounded Serializable snapshot recovery. | Hosted Linq line ownership and rollout | High | 2026-09-11 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account data export and deletion workflow, store coverage, security checks, retention limits, and the authenticated canary diagnostic-retention exception. | Hosted account privacy workflow | High | 2026-05-13 |
| `docs/hosted-runtime-log-database.md` | OpenAI 30-second stream-idle policy and local proof limits; dedicated hosted runtime-log Postgres ownership, bounded container V8 CPU attribution with process counters and event-loop delay, bounded reply-skip reason codes, whole-pass device import no-op counts, temporary outbound crypto pending-join diagnostics, deletion fence, canary reset diagnostic retention through post-promotion contract cleanup, retention, web-control preflight rejection attribution, shared-CLI usage-profile timing contract (phases, transport bounds, assembled-bundle owner parity, coverage, and consumer-first rollout), foreground-wake summaries with fingerprinted correlation and caller/transport attribution, migration preflight, and rollback floor. | Hosted runtime observability storage and usage-profile diagnostics | High | 2026-09-11 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-05-13 |
| `docs/incident-response.md` | Canonical incident.io-backed runbook for declaring, coordinating, communicating, resolving, and learning from Murph production incidents. | Incident coordination and public status policy | High | 2026-08-05 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-08-05 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/strategy.md` | Current product strategy. | Current product strategy | High | 2026-07-15 |
| `agent-docs/PRODUCT_SENSE.md` | Product posture, scope, member workspace troubleshooting, and complete unfiltered private workspace archives. | Current product behavior | High | 2026-09-17 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules. | Product principles | High | 2026-07-15 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`. | Current frontend implementation guidance | Medium | 2026-08-31 |
| `agent-docs/product-marketing-context.md` | Product/marketing decisions. | Product/marketing decisions | High | 2026-07-15 |
| `agent-docs/user-interviews.md` | User research method. | User research method | Medium | 2026-07-12 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails, channel-scoped Linq inactivity admission, exact-receipt iMessage retry with nullable provider service, first Linq delivery timing versus receipt ordering, deadline-bounded immutable artifact transport replay, request-local R2 PUT recovery and bounded outbound storage error responses, immutable wearable notification replay, durable retry ownership with typed active canonical-write contention, companion upload buffering with scoped hydration key reuse, accepted-mailbox progress evidence, generated-image retention reason counts, snapshot response diagnostics with bounded header framing categories and deadline-bounded recovery of incomplete reads, and exact owner release with metadata-only checkpoint timing and deferred checkpoint wake-service initialization. Runnable-only device backlog notices preserve scheduled retry stall evidence. | Runtime reliability policy | High | 2026-09-17 |
| `agent-docs/operations/stripe-effect-compatibility-cutover.md` | Hosted billing operations. | Hosted billing operations | High | 2026-08-28 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, exact-message transport authority for Linq retry, hosted media receipt recovery and atomic retirement, and escalation rules; privacy-safe pre-guard phone-sync provider diagnostics, bounded private context and active encryption-root preparation for canonical channel greetings, retired member shell-hint boundary, and protected read-only checkpoint recovery assessment. | Security policy | High | 2026-09-12 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/2026-07-23-connected-source-launch-gate.md` | Connected-source permission assumption, launch status, and ongoing provider controls. | Connected-source release gate | High | 2026-07-23 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-07-16 |
| `agent-docs/product-specs/nutrition-totals-card.md` | Logged-so-far nutrition cards without mandatory targets; invitation evidence, recovery, and native skew. | Nutrition card product spec | High | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-11-nutrition-totals-card.md` | Completed implementation, assistant proof and review for optional-goal daily cards. | Completed execution plan | High | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-12-channel-welcome-reader-rollout.md` | Consumer-first release extraction for channel welcomes; production rollout remains with the deployment owners. | Historical implementation evidence | Low | 2026-09-12 |
| `agent-docs/product-specs/imessage-workout-tracking.md` | iMessage workout product spec and chat-only routine access. | iMessage workout product spec | High | 2026-09-08 |
| `agent-docs/product-specs/bring-your-own-inference.md` | Personal custom inference contract covering verified member-owned endpoints, settings without runner wakes, mailbox revision handoff, explicit selection, no silent fallback, privacy, metering, and recovery. | Hosted assistant/custom inference product spec | High | 2026-07-31 |
| `agent-docs/product-specs/measured-biomarker-index.md` | Curated measured-biomarker navigation over preserved private lab history. | Biomarkers product spec | High | 2026-07-20 |
| `agent-docs/product-specs/journal.md` | Private web and native timelines derived from canonical health records. | Journal product spec | High | 2026-09-06 |
| `agent-docs/product-specs/personal-patterns.md` | Private context-to-outcome findings, desktop comparisons, and mobile cards with changed results, compact neutral states, tappable recorded-day counts, and inline comparison sample sizes. | Personal Patterns product spec | High | 2026-09-10 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/starter-usage.md` | Non-expiring $4.50 starter usage on the immutable credit ledger, text entry, subscription access for Images and Responses HTTP/WebSocket generation, and abuse alerts; retained paid legacy compatibility. | Hosted access/billing product spec | High | 2026-09-11 |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Edge-to-Pulse renewal switches plus the web-owned hosted assistant configuration and personalization resolvers. | Hosted billing/current-state spec | High | 2026-07-30 |
| `agent-docs/product-specs/hosted-plan-usage.md` | Hosted billing/current-state spec. | Hosted billing/current-state spec | High | 2026-08-18 |
| `agent-docs/product-specs/hosted-group-member-plan.md` | Private $3.50 Core subscription for confirmed hosted-group members. | Hosted billing/product spec | High | 2026-08-25 |
| `agent-docs/product-specs/labs-discovery.md` | Private conversational Labs discovery and retired browser entrypoints. | Hosted Labs product spec | High | 2026-07-16 |
| `agent-docs/product-specs/hosted-usage-topups.md` | Hosted billing/product spec. | Hosted billing/product spec | High | 2026-08-26 |
| `agent-docs/product-specs/hosted-usage-referrals.md` | Hosted growth/product spec. | Hosted growth/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/physical-notes.md` | Hosted physical-note product spec. | Hosted physical-note product spec | High | 2026-08-21 |
| `agent-docs/product-specs/hosted-support-escalation.md` | Hosted support product spec. | Hosted support product spec | High | 2026-08-05 |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted billing/product spec. | Hosted billing/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/health-commons.md` | Health Commons behavior. | Health Commons behavior | High | 2026-07-29 |
| `agent-docs/product-specs/public-goal-guides.md` | Goal guide behavior. | Goal guide behavior | High | 2026-09-14 |
| `agent-docs/product-specs/murph-safe-public-product-search.md` | Public product evidence behavior. | Public product evidence behavior | High | 2026-09-02 |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Health Commons protocol card copy | High | 2026-04-30 |
| `agent-docs/product-specs/murph-onboarding.md` | Aspiration-anchored new-member onboarding contract for a private broad-assistant relationship. | New-member onboarding behavior | High | 2026-09-05 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment onboarding behavior. | Experiment onboarding behavior | High | 2026-07-30 |
| `agent-docs/product-specs/experiment-adherence-confidence.md` | Read-time assumed adherence, confidence ladder, correction semantics, category-scoped activity evidence, and typed subjective session evidence for experiments. | Experiment adherence behavior | High | 2026-07-16 |
| `agent-docs/product-specs/experiment-outcome-selection.md` | Experiment-only selection rules for member-valued and capturable outcomes, credible evidence, typed session metrics, timeframe integrity, and setup handoff. | Experiment outcome selection behavior | High | 2026-07-16 |
| `agent-docs/product-specs/protocol-outcome-network.md` | Protocol outcome network boundary for private outcome cards now and future sharing, contribution, cohort summaries, and social guardrails. | Outcome network behavior | High | 2026-05-13 |
| `agent-docs/product-specs/captures.md` | Capture behavior. | Capture behavior | High | 2026-08-10 |
| `agent-docs/product-specs/companion-app.md` | Companion app plan. | Companion app plan | High | 2026-08-13 |
| `agent-docs/product-specs/query-metric-universality.md` | Universal metric queryability invariant: every metric-bearing canonical event yields a query metric point through the generic extraction rule. | Query metric product spec | High | 2026-07-22 |
| `agent-docs/product-specs/companion-app-mvp.md` | Companion app build and authentication recovery telemetry contract. | Companion app build plan | High | 2026-09-05 |
| `agent-docs/product-specs/ios-address-book-advisory-names.md` | Companion/group privacy contract. | Companion/group privacy contract | High | 2026-08-28 |
| `agent-docs/product-specs/habitat.md` | Habitat product spec. | Habitat product spec | High | 2026-08-11 |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step with member-chosen contact-card avatar, independent from `/home` first-visit personalization. | Contact-card picker spec | Medium | 2026-07-22 |
| `agent-docs/product-specs/murph-personas.md` | Murph persona behavior. | Murph persona behavior | High | 2026-07-22 |
| `agent-docs/product-specs/murph-tone-and-voice.md` | Murph speaking-style preference spec. | Murph speaking-style preference spec | Medium | 2026-08-10 |
| `agent-docs/product-specs/shared-message-targeting.md` | Shared opaque accepted-message reference, authority resolver, native-reply marker, reaction reuse, provider behavior, and immediate runner rollout contract. | Assistant messaging behavior | High | 2026-07-16 |
| `agent-docs/product-specs/group-chat-social-dynamics.md` | Group conversation behavior, unanswered-request reconsideration, and requested graph presentation. | Group conversation behavior | High | 2026-09-17 |
| `agent-docs/product-specs/group-managed-automations.md` | Implemented member/group managed-owner isolation, execution checks, and retirement behavior. | Managed group automation behavior | High | 2026-07-26 |
| `agent-docs/product-specs/group-health-newsletter.md` | Group newsletter behavior. | Group newsletter behavior | Medium | 2026-08-22 |
| `agent-docs/product-specs/group-challenge-formats-and-scorecards.md` | Individual, team, and collective challenge formats plus one-to-five model-interpreted additive components with deterministic point arithmetic and aggregation. | Group challenge scorecards | High | 2026-07-29 |
| `agent-docs/product-specs/group-challenge-data-diagnostics.md` | Group diagnostics, plain metric permissions with 90-date retention, source coverage, and consumer-first rollout limits. | Group challenge diagnostics | High | 2026-09-18 |
| `agent-docs/exec-plans/completed/2026-09-17-group-three-month-history.md` | Completed 90-day group-sharing implementation, consent proof, review and rollout constraints. | Historical implementation evidence | Low | 2026-09-18 |
| `agent-docs/product-specs/challenge-standings-card.md` | Group challenge standings response card. | Group challenge standings response card | High | 2026-08-11 |
| `agent-docs/product-specs/personal-group-awareness.md` | Personal Murph read access to hosted-group memberships. | Hosted group self-awareness | High | 2026-08-29 |
| `agent-docs/product-specs/private-group-consultation.md` | Hosted group consultation. | Hosted group consultation | High | 2026-08-28 |
| `agent-docs/product-specs/consented-group-disclosure.md` | Hosted group disclosure. | Hosted group disclosure | High | 2026-08-26 |
| `agent-docs/product-specs/hosted-group-join-confirmation.md` | Hosted group membership behavior. | Hosted group membership behavior | High | 2026-07-23 |
| `agent-docs/product-specs/clinical-records-intake.md` | Bounded clinical import, optional daily checks, provider search, document enrichment reuse, saved results and privacy controls. | Clinical Records intake behavior | High | 2026-09-15 |
| `agent-docs/references/epic-automatic-distribution.md` | Epic automatic-distribution API matrix, hospital-approved imports, optional persistent credentials and privacy questionnaire guidance. | Epic import registration and rollout | High | 2026-09-15 |
| `agent-docs/phone-calls/retell-phone-agent.md` | Retell hosted phone agent prompt, authority, transfer, and call-brief handling rules. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/phone-calls/retell-analysis-fields.md` | Retell post-call analysis field contract and transcript-retention boundary. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/feature-user-story-audit/README.md` | Feature user-story audit overview and artifact inventory. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/gap-triage.md` | Triage notes for gaps found during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/parse-warnings.md` | Parser warnings captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/testing-errors.md` | Test errors captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/testing-ci-map.md` | Verification map for packages, apps, locked usage-period acquisition, full canonical Codex tool-contract/CLI-upgrade guards and payload captures, hosted media follow-up proof, smoke flows, cancellation-config parity, exact-head PR CI, protected-main runtime proof, deferred-tool advertisement fixtures, canonical executors, shared runtime fixture preparation, compiler cache policy, and current coverage owners, including composed vault-share deadline, device dirty-payload classification/reconnect PostgreSQL proof, encrypted v2 hosted-local snapshot fixtures and canonical assertion readers with marked Docker bridge admission and canonical base64url IV validation, and independent Environment checkpoint ownership that preserves the earlier default-owned prefix, actual Habitat replica content, and metadata-only checkpoint timing with exact future-continuation owner release, accepted-runtime admission observation for reminder/device fairness, real Junction replay through a retained consumer wake and strict hosted completion with progress/auth checks, restored Environment completion after foreground replacement with real retry and second-message preemption proof, structural provider-stub failure diagnostics, shared Linq fixture CDN origins that preserve canonical metadata authentication, standby deadline fixtures, contention-aware PostgreSQL milestone proof, and monotonic foreground mailbox frontiers with same-user successor continuation evidence. Includes bounded live selector diagnostics, read-only exact-name discovery, selectable latency-query correctness and stress proof, and bounded signed Linq webhook redelivery proof. | Testing and CI truth | High | 2026-09-11 |
| `packages/core/bench/README.md` | Secret-free Docker import and hydration reproduction, required one-vCPU latency CI budgets, and sizing evidence limits. | Container CPU benchmark | Medium | 2026-09-04 |
| `packages/core/bench/container-sizing.md` | Synthetic Docker CPU/RAM sizing matrix, foreground profiling, and limits of production downsizing evidence. | Container sizing investigation | Medium | 2026-09-09 |
| `packages/query/bench/README.md` | Reproduce synthetic query resource measurements through public canonical and query APIs in constrained Docker containers. | Query resource benchmarks | Medium | 2026-09-09 |
| `packages/vault-usecases/bench/wearable-sources.md` | Measured public-usecase source-health benchmark: reusable wearable projection, fixed workloads, strict saved-result replay, repeat cohorts, retained global-position flags and synthetic timing limits. | Source-health performance | Medium | 2026-09-13 |
| `agent-docs/exec-plans/completed/2026-09-13-source-list-projection-independence.md` | Completed wearable-projection implementation and parent validation evidence; cohort reporting correction, retained global-position diagnosis, and final exact-head completion gates. | Source-health execution plan | Medium | 2026-09-13 |
| `packages/vault-usecases/bench/README.md` | Synthetic experiment-progress timing through the composed usecase, semantic parity, and baseline comparison limits. | Experiment progress performance | Medium | 2026-09-11 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-postgres-runtime.md` | Postgres execution authority, native wake and completion, uploads, bounded cleanup cadence, heartbeat-free snapshot publication with one managed session/receipt read, seven-day encrypted checkpoint recovery history, replacement vault integrity, user deletion, local controls, completed cutover, and retained migration history. | Hosted runtime ownership | High | 2026-09-20 |
| `agent-docs/references/hosted-runtime-protocol.md` | System checkpoint cancellation and numeric mailbox Web/Worker timing; Hosted operator provider authentication, mailbox/workspace checkpoints, v2-only live restore, derived artifact availability, inert legacy cache manifests, retained legacy object cleanup and canonical receipt recovery, hot admission and bounded history reads, stale delivery-wake recovery, exact ownership, idle restore publication, and accepted-work monitoring, including independent workspace attempts, shared canonical publication, single-pass device-hint coverage, bounded late system-mailbox import after completion recording with covered-schedule retirement and locked stale-schedule rejection, validated continuation scheduling, provider cadence separated from runtime retry deadlines, independent maintenance, bounded retention failure/blocker retries and stage diagnostics, future retry wakes after cold restore, vault-share deadline revalidation, fenced prior-snapshot reuse, background Browser Vault freshness, retired member shell hints with historical latency reads, deadline-bound operator diagnostic execution and status, exact future-continuation owner release, metadata-only checkpoint timing, committed Browser Vault publication before subsequent ordinary due work with timeout continuation delivery, completion ownership across foreground handoff and reuse, observation-only active-fence liveness without cleanup deferral, and bounded consent-aware group wearable freshness requests with source-specific gaps, independent recent-date recovery, conservative historical absence, and shared-history recovery, honest check times and optional schedule recovery. | Hosted execution architecture and bounded device-sync drain budgets | High | 2026-09-12 |
| `agent-docs/references/hosted-temporal-orchestration.md` | Hosted Temporal orchestration, compatible controller-first bootstrap, acknowledged checkpoint rechecks, digest-bound production-core release admission, and explicit Web admission status delivery. | Hosted Temporal orchestration target | High | 2026-09-11 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Paused giant-file cleanup planning guidance and current worth-planning/keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-09-10 |
| `agent-docs/research/2026-08-23-vault-cli-error-recovery-audit.md` | Point-in-time exhaustive Vault CLI audit of generic, lossy, untyped, misleading-success, and privacy-unsafe error paths, with prioritized model-recovery work packages. | CLI error-recovery audit | Medium | 2026-08-24 |
| `agent-docs/research/2026-08-13-alternating-routine-set-resolution.md` | Privacy-safe production correlation and root-cause analysis for repeated strength-set completions attributed to the wrong exercise in an alternating routine. | Investigation artifact | Medium | 2026-08-13 |
| `agent-docs/research/2026-08-05-ios-android-companion-parity-audit.md` | Mobile companion parity audit. | Mobile companion parity audit | Medium | 2026-08-05 |
| `agent-docs/research/2026-07-16-codex-session-architecture-audit.md` | Point-in-time aggregate evidence from the frozen 30-day Codex session audit. | Architecture audit research artifact | Medium | 2026-07-18 |
| `agent-docs/research/2026-07-10-junction-labs-commerce-and-fulfillment.md` | Point-in-time Junction lab-ordering research and phased product, commerce, fulfillment, result-import, and launch-gate proposal. | Research and future planning artifact | Medium | 2026-07-10 |
| `agent-docs/research/2026-09-11-junction-historical-sweep-efficiency.md` | Official Junction webhook/history contracts, daily safety-sweep rationale, targeted refreshes, and validation gaps. | Research and future planning artifact | Medium | 2026-09-11 |
| `agent-docs/research/2026-06-25-imessage-line-flag-evidence.md` | Point-in-time redacted evidence note for the 2026-06-25 iMessage line flag investigation. | Investigation artifact | Medium | 2026-06-26 |
| `agent-docs/operations/agent-workflow-routing.md` | Task scope, authority, checkout, commits, and instruction ownership. | Agent workflow routing | High | 2026-09-11 |
| `agent-docs/operations/product-ux.md` | Product UX workflow. | Product UX workflow | High | 2026-08-31 |
| `agent-docs/operations/live-provider-canaries.md` | Fresh native, Linq, Stripe and Garmin provider outcomes; bounded Linq observation retries, GitHub dispatch, protected execution, exact receipts and cross-repository rollout. | Live provider proof | High | 2026-09-19 |
| `agent-docs/operations/native-android-hosted-e2e.md` | Native Android verification operations. | Native Android verification operations | High | 2026-09-01 |
| `agent-docs/operations/verification-and-runtime.md` | Verification ownership by delivery path, Draft-before-push readiness, CI compiler memory and production-build proof, independent worktree build outputs, verified remote-tracking base refresh, authorized base reconciliation with bounded conflict resolution, Temporal integration build/process-shard proof, remote browser health readiness, wearable browser failure evidence captured before cleanup, and HTTP/destination validation before persisted connection assertions. Wearable production Web preparation, stage forwarding, numeric host progress, and bounded Actions notice retention, with Vercel initial typecheck budget ownership. | Verification policy | High | 2026-09-12 |
| `agent-docs/operations/database-transaction-starvation-audit.md` | Database critical-section reliability. | Database critical-section reliability | High | 2026-08-09 |
| `agent-docs/operations/typescript-verification-performance.md` | Verification performance policy. | Verification performance policy | Medium | 2026-07-29 |
| `agent-docs/operations/completion-workflow.md` | Parent-owned completion evidence, final ReviewGPT eligibility and recovery before the first valid review, verified-base mergeability, and Draft-before-push ordering; specialist passes are retired. | Completion workflow | High | 2026-09-11 |
| `agent-docs/operations/imessage-deliverability.md` | Phone-number messaging policy, iMessage-only inactivity and canonical requested-Ask exemptions, and direct duplicate handoff identity. | Phone-number messaging policy | High | 2026-09-17 |
| `agent-docs/operations/local-storage-lifecycle.md` | Local rebuildable-storage lifecycle, guarded retirement, and dependency hook setup. | Local rebuildable-storage lifecycle | High | 2026-09-11 |
| `agent-docs/operations/hosted-local-worktree-dev.md` | Local hosted runtime workflow, call-scoped cancellation, and exact-child startup/exit cleanup ownership. | Local hosted runtime workflow | Medium | 2026-09-05 |
| `agent-docs/operations/pr-reviewgpt-loop.md` | PR review for realistic serious bugs and material Complexity Collapse, with a three-round review cap, exact tracked archive inputs, no base-update limit, response timing and evidence requirements, same-session waiting or paced polling by default, exact-metadata recovery after capture failure, and invalid-first-attempt baseline recovery. | Final PR ReviewGPT loop | Medium | 2026-09-11 |
| `agent-docs/operations/device-sync-ingestion-invariants.md` | Device-sync push/pull ingestion, daily recovery, checkpoint-owned continuation preflight, bounded deferral of future history, pending-start history scans, bounded completion-marker retention, and operation-local source admission reuse. | Device-sync ingestion contract | High | 2026-09-20 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules. | Plan workflow | Medium | 2026-03-31 |
| `agent-docs/exec-plans/completed/2026-09-13-cli-validation-diagnostics.md` | Bounded optional schema diagnostics, three existing knowledge source classifications and consumer-first rollout contract. | CLI diagnostics execution plan | High | 2026-09-13 |
| `agent-docs/exec-plans/completed/2026-09-13-browser-vault-source-read-telemetry.md` | Fixed source-operation timing through existing Browser Vault timeout telemetry, with behavior-preserving proof and rollout gates. | Completed diagnostic implementation | High | 2026-09-13 |
| `agent-docs/exec-plans/completed/README.md` | Completed-plan archive interpretation. | Completed-plan archive interpretation | Medium | 2026-07-22 |
| `agent-docs/exec-plans/completed/2026-09-11-junction-temporal-efficiency.md` | PR #3311: daily queued temporal sweeps, targeted day refreshes, checkpoint-safe recovery, no-op counters, and resolved final review. | Historical implementation evidence | Low | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-14-parallel-audio-preparation.md` | Bounded consecutive audio preparation patch, ordered publication and replay proof, and local validation. | Historical implementation evidence | Low | 2026-09-14 |
| `agent-docs/exec-plans/completed/2026-09-11-runner-wake-latency.md` | Small-runner admission capacity recovery, protected rollout convergence, and live reply verification. | Historical implementation evidence | Low | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-10-environment-checkpoint-projection.md` | Clean-return system-work settlement, Environment publication regression, and focused runtime proof. | Historical implementation evidence | Low | 2026-09-10 |
| `agent-docs/exec-plans/completed/2026-09-10-member-one-vcpu.md` | Dedicated smaller-container deployment, native CLI bootstrap proof and pending natural-traffic measurement. | Historical implementation evidence | Low | 2026-09-10 |
| `agent-docs/exec-plans/completed/2026-09-14-device-failure-evidence.md` | Device-only failure evidence and parent local validation/review; external PR review, exact-head CI and authorized deployment pending. | Historical implementation evidence | Low | 2026-09-14 |
| `agent-docs/exec-plans/completed/2026-09-06-all-tool-failure-diagnostics-extension.md` | Separate PR #2985 telemetry extension record; original completed plan unchanged. | Historical implementation evidence | Low | 2026-09-06 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/completed/2026-09-09-bundled-cli-query-timing-owner.md` | Exact-leaf runner bundle correction and proof handoff; actual assembled validation and parent evidence pending. | Historical implementation evidence | Low | 2026-09-09 |
| `agent-docs/exec-plans/completed/2026-09-10-billing-browser-hydration.md` | Real React and Chromium proof for billing control replacement during hydration; provider outcome checks remain owned by the protected live matrix. | Historical implementation evidence | Low | 2026-09-10 |
| `agent-docs/exec-plans/completed/2026-09-11-research-scout-batch-concurrency.md` | Local two-lane scout scheduling implementation and synthetic proof handoff; parent source-suite, benchmark, and reply verification pending. | Historical implementation evidence | Low | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-12-reply-wake-latency.md` | Migration-only foreground completion, retained background reconciliation, focused source proof, and production latency evidence gaps. | Historical implementation evidence | Low | 2026-09-12 |
| `agent-docs/exec-plans/completed/2026-09-12-foreground-maintenance-deletion.md` | Removal of foreground route housekeeping and the interim migration-only mode; background and idle migration remain authoritative. | Historical implementation evidence | Low | 2026-09-12 |
| `agent-docs/exec-plans/completed/2026-09-12-dashboard-auto-signin.md` | Automatic dashboard sign-in and current-page resumption verification. | Historical implementation evidence | Low | 2026-09-12 |
| `agent-docs/exec-plans/completed/2026-09-14-remove-small-runner.md` | Removal of the temporary member-specific container experiment and protected retirement prerequisites. | Historical implementation evidence | Low | 2026-09-14 |
| `agent-docs/exec-plans/completed/2026-09-20-edge-device-calls.md` | Remove empty device apply callbacks and reuse operation-local source admission. | Device request reduction evidence | Medium | 2026-09-20 |
| `agent-docs/exec-plans/completed/2026-09-14-postgres-runtime-owner.md` | UserRunner removal, Postgres runtime authority, resource cutover, and focused integration proof. | Completed runtime ownership implementation and proof | Medium | 2026-09-15 |
| `agent-docs/exec-plans/completed/2026-09-17-instant-reply-typing-alert.md` | Accepted Web instant-reply delivery links, replay and post-response proof, and PostgreSQL typing-alert exclusion. | Local implementation evidence | Medium | 2026-09-17 |
| `agent-docs/exec-plans/completed/2026-09-17-graph-palette.md` | Documented chart palette, attachment-owned numeric captions, and focused model proof for PR #3515. | Chart guidance follow-up | Medium | 2026-09-17 |
| `agent-docs/exec-plans/completed/2026-09-18-food-search-ranking.md` | PR #3564: implementation and final review complete; 134-test PostgreSQL 17 owner passed; final exact-head CI gate remains on the open PR. | Completed implementation evidence | Medium | 2026-09-18 |
| `agent-docs/exec-plans/completed/2026-09-18-automation-list-validation-telemetry.md` | Finite automation-list validation attribution, parent native/local proof and old-reader compatibility; final PR records review, CI and deployment outcomes. | Historical implementation evidence | Medium | 2026-09-18 |
| `agent-docs/exec-plans/active/` | Task-owned in-flight execution plans. | Active plan lifecycle | Medium | 2026-08-20 |
| `agent-docs/exec-plans/completed/2026-09-17-research-scout-failure-telemetry.md` | Three exact research error codes, parent-native verification and old-reader compatibility; rollout tracked separately. | Historical implementation evidence | Medium | 2026-09-17 |
| `agent-docs/exec-plans/completed/2026-09-15-vercel-memory-headroom.md` | Vercel typecheck OOM recovery verification, native compiler memory comparisons, and compilation-only esbuild memory target. | Build memory investigation and local proof | Medium | 2026-09-15 |
| `agent-docs/exec-plans/completed/2026-09-15-foreground-priority-transition-gate.md` | Foreground priority escape analysis, three-history transition matrix, required CI gate, and PR review evidence. | Historical implementation evidence | Low | 2026-09-15 |
| `agent-docs/exec-plans/completed/2026-09-15-foreground-mode-priority.md` | Effective foreground mode after system promotion, checkpoint interruption and deferred-effect regressions, and local validation. | Historical implementation evidence | Low | 2026-09-15 |
| `agent-docs/exec-plans/completed/2026-09-15-prisma-pool-pressure.md` | Actual-checkout pool-pressure sampling, healthy transaction regression, and PostgreSQL fault-injection proof. | Completed diagnostic fix | Low | 2026-09-15 |
| `agent-docs/exec-plans/completed/2026-09-13-browser-vault-refresh-efficiency.md` | Narrow experiment-source hashing and a bounded Browser Vault refresh budget, with synthetic cost and cancellation proof. | Completed runtime fix | High | 2026-09-13 |
| `agent-docs/exec-plans/completed/2026-09-10-linq-acceptance-receipt-lock.md` | PR #3262: first-turn receipt serialization, composed PostgreSQL proof and final review; final-head CI tracked on the PR. | Historical implementation evidence | Low | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-11-pinned-release.md` | Candidate-preserving release checks and public ancestry admission; paired PRs track final CI and private-first rollout. | Historical implementation evidence | Low | 2026-09-11 |
| `agent-docs/exec-plans/completed/2026-09-11-release-compatibility-safeguards.md` | Production protocol-skew recovery, live consumer admission, credential-bounded proof, and required scheduled Telegram integration with composed delivery and fairness verification. | Historical incident and prevention evidence | Low | 2026-09-13 |
| `agent-docs/exec-plans/completed/2026-09-10-testing-linq-wire-contract.md` | Strict Linq HTTP contract proof, canonical container egress, and recorded bundle-budget verification gap. | Historical testing evidence | Low | 2026-09-10 |
| `agent-docs/exec-plans/completed/2026-09-09-runtime-mailbox-hardening.md` | PR #3102: shared runnable admission and device-hint coverage, producer-reader contracts, and cold-restore regression proof. | Historical implementation evidence | Low | 2026-09-09 |
| `agent-docs/exec-plans/completed/2026-09-09-runtime-mailbox-recovery-rollout.md` | Reviewed runtime-mailbox fixes, protected rollout convergence, and verified recovery of the original incident cohort. | Historical implementation evidence | Low | 2026-09-09 |
| `agent-docs/exec-plans/completed/2026-09-08-shared-codex-tool-input-contract.md` | PR3059 canonical tool-contract preservation, measured payloads, five Ready journeys, and validated final review/CI closure. | Historical implementation evidence | Low | 2026-09-08 |
| `agent-docs/exec-plans/completed/2026-09-08-device-checkpoint-replay.md` | PRs #3080 and #3084: reproduced continuation validation failure, corrected reader, and verified live progress recovery. | Historical implementation evidence | Low | 2026-09-09 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke seam prompts governed by a shared review-only, evidence, correction, and zero-finding contract. | Seam-audit prompt library | Low | 2026-07-13 |
| `apps/web/README.md` | Hosted Web setup, runtime ownership, build/deploy contracts, and bounded legacy phone-call deletion execution. | `apps/web/**` | Medium | 2026-09-10 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview, runtime contract, and retired member shell-hint transport. | `apps/cloudflare/**` | Medium | 2026-09-10 |
| `apps/cloudflare/scripts/benchmark-workspace-restore.md` | Synthetic encrypted restore benchmark, measurement controls, and local/Linux limitations. | Cloudflare workspace restore | Medium | 2026-09-04 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution, consumer-first Web runtime admission, single-pool capacity, isolated artifact smoke, compatible native gradual rollout, and member shell-hint transport retirement. | Hosted deploy flow | Medium | 2026-09-10 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime, durable completion, and Browser Vault wake qualification. | `packages/assistant-runtime/**` | Medium | 2026-09-11 |
| `packages/device-syncd/README.md` | Local wearable sync runtime boundary and env contract. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/clinical-records/README.md` | Pure Clinical Records Intake contracts for raw FHIR retrieval manifests, deterministic source references, import-plan decisions, and bounded document-extraction proposals. | `packages/clinical-records/**` | Medium | 2026-09-11 |
| `packages/health-metrics/README.md` | Neutral metric contracts, wearable catalogs, sample summaries, reviewed lab ranges, normalization, display formatting, and selection policy. | `packages/health-metrics/**` | Medium | 2026-09-10 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/query/README.md` | Query projection ownership, strict source-health snapshot capture, provider-projected parity and no-publication fast paths. | `packages/query/**` | Medium | 2026-09-13 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, generated-delivery ref ownership, hosted state rules, and hosted Codex rollout snapshot scope without ChatGPT auth portability. | `packages/runtime-state/**` | Medium | 2026-07-16 |
| `packages/vault-usecases/README.md` | CLI/headless vault usecase orchestration boundary over core, importers, and query. | `packages/vault-usecases/**` | Medium | 2026-05-02 |

The completed Home account-check optimization and local proof are recorded in
[`2026-09-15-home-first-paint.md`](exec-plans/completed/2026-09-15-home-first-paint.md).

The broader dashboard latency work is recorded in
[`2026-09-15-dashboard-latency.md`](exec-plans/completed/2026-09-15-dashboard-latency.md).

The admission and runtime launch reduction is recorded in
[`2026-09-17-ingress-admission-simplification.md`](exec-plans/completed/2026-09-17-ingress-admission-simplification.md).

Five-minute ingress cache retention and member isolation proof are tracked in
[`ingress cache retention`](exec-plans/completed/2026-09-21-ingress-cache-five-minutes.md).

## Conventions

Local feedback diagnostics are documented in
`.agents/skills/feedback-diagnostics/SKILL.md`; `scripts/ops-feedback` owns the
agent-facing command and dedicated browser session.

- Keep one short discovery description per document; detailed behavior belongs
  in that document and its executable owner, not this index.
- Update entries when docs are added, removed, moved, or materially repurposed.
- Research and audits are evidence for their stated date, not operating policy.
- Completed plans are immutable historical snapshots. Use live owner docs for
  implementation, deployment, rollback, and incident response.

The hosted-local activity-expiry target correction is recorded in
[`2026-09-15-recovery-test-targets.md`](exec-plans/completed/2026-09-15-recovery-test-targets.md);
its active/retained target and namespace-routing proof is owned by the testing CI map.

Provider-search delivery is recorded in
[`2026-09-15-records-connect-polish.md`](exec-plans/completed/2026-09-15-records-connect-polish.md).
The separate registration activation and composed import proof remain active in
[`2026-09-16-epic-import-live-verification.md`](exec-plans/active/2026-09-16-epic-import-live-verification.md).

The channel-scoped inactivity pause and local proof are recorded in
[`2026-09-17-imessage-proactivity-pause.md`](exec-plans/completed/2026-09-17-imessage-proactivity-pause.md).

The Responses relay queue-pressure observation and implementation proof are recorded in
[`2026-09-17-websocket-queue-pressure-telemetry.md`](exec-plans/completed/2026-09-17-websocket-queue-pressure-telemetry.md).

- Recovery implementation: [`runtime retirement recovery`](exec-plans/completed/2026-09-17-runtime-retirement-recovery.md)
  covers interrupted binding and claimed unbound target retirement.

- Test diagnostic correction: [`Worker stderr failure capture`](exec-plans/completed/2026-09-17-runtime-failure-stderr.md)
  records bounded terminal-error evidence from both Worker output streams.

- OTP resend admission: [`OTP resend recovery`](exec-plans/completed/2026-09-17-otp-resend-recovery.md).

Clinical Journal date provenance and native record presentation cleanup:
[`2026-09-18-clinical-journal-cleanup.md`](exec-plans/completed/2026-09-18-clinical-journal-cleanup.md).

Zero-valued SpO2 sample handling is tracked in
[`2026-09-18-spo2-zero-samples.md`](exec-plans/completed/2026-09-18-spo2-zero-samples.md).

Warm-wake request reduction evidence: [`2026-09-20-edge-request-reduction.md`](exec-plans/completed/2026-09-20-edge-request-reduction.md).

Authoritative empty-day recovery is recorded in
[`2026-09-18-canonical-empty-day-recovery.md`](exec-plans/completed/2026-09-18-canonical-empty-day-recovery.md).

Personal Patterns repeat-suppression proof is recorded in
[`2026-09-20-insight-dedupe.md`](exec-plans/completed/2026-09-20-insight-dedupe.md);
`ARCHITECTURE.md` owns the current cross-automation history contract.

Interactive voice-orb design playground implementation and proof are tracked in
[`2026-09-20-voice-orb.md`](exec-plans/completed/2026-09-20-voice-orb.md).

Voice-orb browser and PNG fallback proof is tracked in
[`2026-09-20-voice-orb-browser-support.md`](exec-plans/completed/2026-09-20-voice-orb-browser-support.md).

Retained-owner device cadence and encoded-empty history convergence proof is tracked in
[`device wake follow-up`](exec-plans/completed/2026-09-21-device-wake-followup.md).

Covered startup mailbox-prefetch reuse and unknown-wake fallback are owned by
`references/hosted-runtime-protocol.md`; implementation is tracked in
`exec-plans/completed/2026-09-21-startup-prefetch-wake.md`.

WhatsApp phone verification across web and native clients is tracked in
[`2026-09-21-whatsapp-phone-auth.md`](exec-plans/active/2026-09-21-whatsapp-phone-auth.md).

Query projection storage reduction is tracked in
[`workspace storage`](exec-plans/completed/2026-09-21-workspace-size.md);
`packages/query/README.md` owns the storage and restore contract.

Query page packing and unused date-index removal are tracked in
[`query page packing`](exec-plans/completed/2026-09-21-workspace-page-packing.md).

Query metric payload deduplication and transaction/restore proof are tracked in
[`metric payload storage`](exec-plans/completed/2026-09-21-workspace-metric-dedup.md).

System checkpoint cancellation and mailbox timing implementation are recorded in
[`typing checkpoint latency`](exec-plans/completed/2026-09-21-typing-checkpoint-latency.md).
