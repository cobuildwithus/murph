# Murph Agent Docs Index

Last verified: 2026-08-14

## Purpose

This index is the table of contents for the current canonical docs in this repository.
It intentionally lists live architecture, product, verification, and package-boundary docs only.

Local setup and assistant delivery no longer own an operational email provider:
setup manages Telegram, the local inbox runtime retains Telegram and Linq, and
generic email remains confined to hosted ingress and injected hosted delivery.
This ownership split is jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/operations/verification-and-runtime.md`,
and `agent-docs/references/testing-ci-map.md`.

Hosted device-sync wake ownership keeps provider cadence in Web's canonical
`nextReconcileAt`, while the encrypted system-mailbox item retains exact
connection-specific retry work and Web dirty rows retain dirty resource/deletion
work across cold replacement. The machine-local SQLite store is an execution
cache; hosted provider scheduling is mailbox-connection scoped, retained wakes
come from actual manifest-shaped queued/running rows, and a durable completion
checkpoint fences canonical cadence publication. An unchanged stale tuple may
re-signal the same durable mailbox item once in each Web recovery bucket without
minting another schedule-event or mailbox-item identity. Provider execution is
intentionally at-least-once across a lost post-pull record/completion checkpoint:
the canonical mailbox item/event already exists in the committed input
workspace. The fixture commits that clean input through the production v2
checkpoint bridge before the four read-only provider classes run. The incident
pass then creates the machine-local SQLite execution record, and its production
v2 post-pull archive plan observes the live store, omits it from the archive, and
retains the durable mailbox state. The proof injects its only failure when that
v2 snapshot checkpoint is persisted, leaving the clean input ref as the last
committed snapshot. The next recovery bucket cold-restores that exact ref through
the production restore dispatch, reconstructs from durable authority, and may
repeat the same method/path classes without publishing cadence early. The
deterministic WHOOP proof covers four initial
classes, one four-class replay (eight requests total), eight measured workspace
checkpoint attempts with seven commits and one injected failure, no third
provider pull, and cadence publication only after the durable recovery/completion
checkpoint. The first later bucket performs one bounded post-publication
convergence checkpoint while returning idle with no wake; the following bucket
is fully quiescent with no provider work or checkpoint.
The contract is jointly specified by
`agent-docs/RELIABILITY.md` and
`agent-docs/references/hosted-runtime-protocol.md`.

Personal-to-group projection convergence, including attempt-local foreground
preemption, abort/shutdown admission before every scope, its single forwarded deadline, and
authoritative Web-response ownership, typed destination-failure isolation,
and deterministic maximum-cardinality proof, is specified by
`ARCHITECTURE.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

The lower-level hosted browser assertion first-invalid boundary, single-use
nonce persisted horizon, mixed-version cleanup safety, and opt-in PostgreSQL
concurrency proof are jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, and `agent-docs/references/testing-ci-map.md`.

Telegram rich routine-card authority, catalog-position image provenance,
single-message fallback ownership, and valid-envelope retry classification
across all Telegram send operations are specified by `ARCHITECTURE.md` and
`agent-docs/RELIABILITY.md`.

Direct-insert hosted callback nonce replay convergence through the
`nonce_hash` primary key, database-clock refusal after the inclusive callback
expiry boundary, plus bounded background retention and its opt-in PostgreSQL
concurrency proof, are jointly specified by `ARCHITECTURE.md`,
`agent-docs/references/hosted-temporal-orchestration.md`, and
`agent-docs/references/testing-ci-map.md`.

Member-owned device provider application ownership, exact OAuth and connection
revision binding, invocation-scoped credential projection, exact token-return
authority, credential-free stored-token cleanup without operator fallback, and
permanent-versus-transient credential failure handling are jointly specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and
`agent-docs/RELIABILITY.md`.

Hosted device-sync dirty admission prepares classification, compression,
sealing, and any clean-to-dirty mailbox wake outside database ownership, then
revalidates consent, connection/source identity, the exact dirty snapshot, and
every applicable exact crypto root under the final admission lock. One exact
winner drift permits one fresh full replan. Compact-only webhook hints skip
dirty crypto preparation, use the canonical final transaction owner, and
prepare a mailbox root only when the locked preflight observes a possible
clean transition; source admission uses an exact, minimally projected, max-one
database read. Built-in webhook admission is capped at two resources,
companion admission carries one, and the final transaction remains
provider-closed. This contract and its focused real-PostgreSQL withdrawal proof
are jointly specified by `ARCHITECTURE.md`, `agent-docs/RELIABILITY.md`,
`agent-docs/operations/device-sync-ingestion-invariants.md`, and
`agent-docs/references/testing-ci-map.md`.

Checkpointed personal health state gets one wake-raced share-projection
opportunity before device-sync maintenance or dirty acknowledgement resumes;
conversation work still preempts, projection failure retains the existing
device continuation, one destination's typed missing-root failure cannot starve
healthy later scopes while shared-infrastructure errors stop fanout, complete
capture binds projected bytes to the vault owner before any
detached delivery, and source-workspace fencing makes an older in-flight
replacement a no-op after a newer checkpoint. Group reads use the current
Web-owned snapshot without per-group fanout or another freshness owner.
The producer-first hard-cut rollout is specified by `apps/cloudflare/DEPLOY.md`.
This contract is jointly specified by `ARCHITECTURE.md`,
`agent-docs/RELIABILITY.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

Hosted cold-start ownership keeps established-member startup on the ordinary
post-Temporal direct ensure so container boot can overlap fenced invocation
preparation. The separate first-contact shell hint is serialized by the
per-user health-data consent barrier. Its route lookup remains mutation-free;
its optional admission abandons after 250 ms, and allowed admission then owns
exact stop-target reservation and container registration. Web admits it only
for an extant, non-suspended member whose grant is not revoked, preserving
missing-grant compatibility only for legacy members that still exist.
Foreground readiness and exact-target
destruction retain priority over the platform wait. Rollout puts Web first,
then drains older containers immediately. This contract is jointly specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

The public footer's fixed, bodyless incident.io status-summary read, strict-origin
transport boundary, display-only authority, and subprocessor disclosure are
jointly specified by `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and
`docs/incident-response.md`.

Static SSH worker archive readiness and executor-owned, resource-qualified
verification scheduling are jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`,
`agent-docs/operations/verification-and-runtime.md`, and
`agent-docs/references/testing-ci-map.md`.

Private current-sender Assistant Ask completion expiry, exact reviewed-text
binding, personal direct-route revalidation at every provider attempt, and
terminal no-fallback failure, plus exact `aask_done_*` pre-checkpoint staging
without generic-notification admission, canonical-sent exact-session
continuity with queue-time causal binding across compatible model changes,
pre-sent first-attended binding without conversation mutation, legacy omission
fail-closed behavior, and unresolved outbox retention,
including bound-only repair before ordinary direct scheduled and Assistant Ask
continuation turns or direct exact-notification history mutation while unbound
ownership stays attended-only,
are jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`,
`agent-docs/operations/verification-and-runtime.md`, and
`agent-docs/references/hosted-runtime-protocol.md` plus
`agent-docs/references/testing-ci-map.md`.

Hosted runtime-progress monitoring and Linq exact-consume reaction confirmation,
including consumed conversation exclusion before lane head/count selection,
bounded raw candidate scans, receipt-backed confirmation-failure ownership, and
provider-no-replay recovery, are jointly specified by
`agent-docs/RELIABILITY.md` and
`agent-docs/references/hosted-runtime-protocol.md`.

Independent partial PlanetScale metric normalization, explicit unknown-family
evidence when either expected connection-error port is missing, continued
evaluation of available database signals, per-port baseline advancement with
new/reset suppression, bounded safe connection-error confirmation with
cross-scrape port composition and without suppressing unsafe observations, and
one-shot telemetry-only operator paging with unresolved-window coalescing,
current-pressure priority including direct and pooled connection errors in one
combined pre-first-page incident, post-ack recurrence suppression, durable
owed-page preservation inside non-replayable category-specific admission,
truthful connection-error and mixed telemetry window provenance, and
rollback-compatible additive state with deliberately compatible physical sample
columns are
jointly specified by `ARCHITECTURE.md`,
`agent-docs/RELIABILITY.md`, `agent-docs/references/testing-ci-map.md`, and
`apps/cloudflare/README.md`.

Automatic meal-photo schema-v2 enrollment ordering, including the one-row
per-installation revision fence, credential-free revocation tombstone,
prepared-before-active iOS credential handoff, bodyless scoped activation,
member-plus-Family-sponsorship authority serialization,
schema-v1 revision-zero compatibility, expand/contract migration sequence, and
focused static, PostgreSQL, and physical-iPhone proof matrix, is jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`,
`agent-docs/operations/verification-and-runtime.md`, and
`agent-docs/references/testing-ci-map.md`.

Protected-main Junction wearable canary credential derivation, handling, and
verification ownership are specified by `agent-docs/SECURITY.md` and
`agent-docs/references/testing-ci-map.md`.

Spread-free official provider SDK request construction, including the generated
Composio client boundary, and the safe opt-in Stripe test-mode resume contract
probe are jointly specified by
`agent-docs/SECURITY.md` and `agent-docs/references/testing-ci-map.md`.

Private generated-image failure diagnostics, their failure-only scope,
untrusted-provider-text boundary, and reader-first hosted compatibility
contract are jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

Ready hosted generated-image completions enter the next Codex admission by
exact trusted input id. If newer conversation input is already waiting, the
completion precedes it in the same frozen batch while the ordinary pending
input index remains the durable retry owner and reconstructs that order after
an invocation restart, including when new foreground input arrives first.
Restored folding is bounded to same-route conversation events strictly after
the completion's trusted origin. The exact authenticated group-route match
excludes provider continuation sessions; ordinary batching still uses them as
a boundary. This contract is jointly specified by `ARCHITECTURE.md`,
`docs/contracts/00-invariants.md`, and
`agent-docs/references/hosted-runtime-protocol.md`.

Hosted inbound reply-thread binding, active-turn route preservation, ephemeral
delivery-context preservation, and provider-rendered iMessage response-card
image and semantic-text fallback are jointly specified by
`ARCHITECTURE.md`, `agent-docs/RELIABILITY.md`, and
`agent-docs/operations/imessage-deliverability.md`.

Venice's code-owned provider-model binding without duplicate deploy variables
provider-aware immutable allowance pricing, explicit Codex prompt-cache
boundary, and capped real-Codex cache-reuse activation gate are jointly
specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`,
`agent-docs/RELIABILITY.md`,
`agent-docs/product-specs/hosted-plan-usage.md`, and the Web and Cloudflare app
docs.

Response-card request eligibility, multi-input live-turn invalidation,
whole-response semantics, delivery ownership, interactive Messages-extension
transcript rendering with a truthful provider-static fallback,
installed-extension nutrition identity, App-Store-icon-free static fallback,
provider-owned card masking, a concise date-and-meal-count nutrition
caption with conditional partial-state and assessed-goal-direction subcaptions,
one trusted provider reply-thread binding, bounded offline V3 compact-table,
V4 workout-session, and V5 challenge-standings fragments, plus the shared
strict queryless static-image route are specified by
`ARCHITECTURE.md`,
`agent-docs/SECURITY.md`,
`agent-docs/RELIABILITY.md`,
`agent-docs/operations/imessage-deliverability.md`, and
`agent-docs/product-specs/imessage-workout-tracking.md` plus
`agent-docs/product-specs/challenge-standings-card.md`.

Hosted R2 uses one canonical ENAM production bucket and one isolated preview
bucket. The Worker binding, presign target, lifecycle helper, cold restore, and
runtime cleanup share that environment-selected owner. Account deletion remains
Web-guarded during the no-OC Worker rollout and until both retired OC buckets
are physically deleted and their API absence is verified; after that, deletion
uses only the canonical ENAM binding. The contract is jointly specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, and
`apps/cloudflare/README.md`.

Signed hosted runtime crypto callbacks are user-bound, workspace-scoped
resource authority without duplicate operation admission. Temporal/UserRunner,
Settings vault export, and ordinary active-member runtime surfaces retain their
own mode, session/MFA/consent, and active-access admission respectively. The
contract is specified by `agent-docs/references/hosted-runtime-protocol.md` and
`agent-docs/references/hosted-temporal-orchestration.md`.

Native companion account admission reuses the canonical capacity-gated signup
welcome for verified phones, completes without a route when no line is
assignable, lets an exact active member's provider-attested direct input bind a
managed reply-safe line without proactive eligibility, keeps the separate Web
welcome email out of the companion path, and retries only the exact pending
activation mailbox wake after a missed runtime signal. This contract is jointly specified by `ARCHITECTURE.md`,
`agent-docs/SECURITY.md`, `agent-docs/product-specs/companion-app.md`, and
`docs/device-sync-hosted-control-plane.md`.

Metadata-only Stripe failure email ownership for terminal checkout and
subscription actions, current-attempt/provider-effect
identity, paid Family capacity/member-transition identity, safe request
correlation through dependency-free hosted-error translation, preservation of
the general runtime's ordinary Node migration/tooling boundary, blind-bound
public redirect ownership, explicit recovery ownership, replay defense, and
the rule that alerts never become billing or retry authority are jointly specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, and
`apps/web/README.md`.

Hosted mailbox and Privy identity preparation use one request-local,
crypto-only exact-root boundary: provider/KMS work settles before `BEGIN`, the
transaction revalidates the precise root under its canonical lock, and a typed
winner drift permits one fresh full preparation attempt. Mailbox callers carry
that generic capability directly, while Privy phone-conflict suppression reads
only blind-index ownership and never decrypts an unprepared second member. The
contract is specified by `ARCHITECTURE.md` and `agent-docs/RELIABILITY.md`.

## Canonical Docs

Member-owned device-provider application authority, including the shared
webhook admission fence for app-bound connections, is jointly specified by
`ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and `agent-docs/RELIABILITY.md`.

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, public package posture, local/hosted runtime tiers, and verification entrypoints. | Current repository state | High | 2026-05-02 |
| `ARCHITECTURE.md` | Top-level module map, trust boundaries, persisted-state rules, canonical finite support-automation ownership and fire-time authority, provider-neutral longitudinal sleep-pattern reads, warm Codex App Server lifecycle and root-turn-only invocation authority, bounded root-plus-three detached child persistence with all-child checkpoint proof, shared accepted-message targeting for native replies and reactions, interactive Messages-extension response-card rendering with a provider-static fallback, one trusted provider reply-thread binding, and offline native decoding, hosted mailbox/checkpoint ownership including read-only Assistant Ask request/reply with exact requester identity, deterministic unavailable copy, post-Temporal direct latency hints, pass-wide joined-group request/completion pre-checkpoint admission, and pass-owned fresh-input completion ordering with a read-only complete-index fallback, exact-grant consented group-to-member disclosure with the ordinary scheduled group runtime plus server-expiry-bounded same-turn polling and no second provider turn, live read-only Labs discovery ownership, durable input-bound subscription-action claims, enforced hosted usage plus generic purchase/referral credit ownership, and the cross-lane per-member causal sequence, canonical companion per-setting watermarks, signed input-bound hosted personality projection/event convergence with private-person versus synthetic-room ownership and current Linq route validation, bounded exact-successor provider-turn batching for personal assistant preferences plus accepted group-room model selection with fixed provider/reasoning, the single-snapshot conversation-ahead handoff and owner-release Temporal recheck, managed hosted Codex auth snapshot boundary, hosted provider egress credential boundary, independent Cloudflare-owned PlanetScale database-health persistence and paced Linq paging, hosted Clinical Records control-plane ownership with all-24 primary query activation and query-scope/slice-bound page authority, hosted computer-use ownership, hosted generated-image ownership with exact-id ready-completion admission and trusted attachment-time byte-metadata canonicalization, hosted Retell phone-call ownership, hosted Linq first-contact admission fail-open policy plus deploy-skew compatibility column, hosted Temporal hard-cut pointer, capacity-gated companion signup welcome with no-line activation and exact pending-activation runtime-wake recovery, bounded device-sync and attempt-owned automatic meal-photo mailbox handoff with ordinary 9pm cron projection, capture engagement, staging cleanup, and foreground-fair dispatch, authenticated-group twice-weekly room-model consolidation over bounded admitted transcripts with one advisory derived page and a current-input write tool, automatic scheduled companion overnight-PRV admission with on-phone reduction, explicit connect/passive-resume authority, one connection/night owner, bounded replay receipts, encrypted retry retention, canonical-success acknowledgement, immutable nightly import, metric separation, physical validation/deployment gates, single-region ENAM R2 ownership, terminal-checkout-action-owned metadata-only Stripe failure alerts without billing authority, plus active-turn targeting lifecycle, control-flow contracts, and package-boundary rules. | Current runtime architecture | High | 2026-08-13 |
| `agent-docs/ARCHITECTURE_GUIDANCE.md` | Pre-implementation decision sequence for outcomes, current owners, evidence, minimum durable corrections, failure and deployment behavior, and focused proof. | Architecture planning guidance | High | 2026-07-18 |
| `PRODUCT.md` | Strategic design context: register, users, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system in Google Stitch DESIGN.md format: color, typography, elevation, components, do's/don'ts, YAML token frontmatter, and reviewable group-usage funding patterns. Loaded by the impeccable skill before any UI work. | Visual design system | High | 2026-07-22 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, package-boundary hygiene notes, and hosted ownership baseline. | Current architectural baseline | High | 2026-05-13 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and cross-cutting invariants, including warm Codex App Server lifetime and bounded root-plus-three detached child persistence. | Canonical vault interface decisions | High | 2026-07-20 |
| `docs/contracts/06-hosted-workspace-file-count.md` | Hosted workspace file-count invariant for restored runtime write paths, checkpoint/restore cost, compact side-effect storage choices, generated-delivery classification, and bounded generated-image payload retention. | Hosted workspace checkpoint/restore contract | High | 2026-08-04 |
| `docs/device-sync-hosted-control-plane.md` | Current hosted control-plane direction for device sync, including encrypted Cloudflare Queue webhook burst transport, serial Web/Postgres admission, companion account admission with the canonical capacity-gated signup welcome, no-line activation, Web-only welcome email, exact pending-activation runtime-wake recovery, encrypted dirty-payload retention, generic terminal acknowledgement, and the companion overnight-PRV lane's bounded replay receipts plus canonical-import acknowledgement. | Device-sync architecture direction | Medium | 2026-08-13 |
| `docs/device-provider-contribution-kit.md` | Maintainer guide for adding wearable providers. | Provider contribution workflow | Medium | 2026-05-13 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations, including the beta direct WHOOP overnight-PRV summary and validation gates. | Device-provider normalization planning | Medium | 2026-07-14 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam and future rotation constraints, including group-scoped consent-permission digests and their in-flight drain floor. | Hosted contact-privacy rotation seam | Medium | 2026-07-16 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account data export and deletion workflow, store coverage, security checks, and retention limits. | Hosted account privacy workflow | High | 2026-05-13 |
| `docs/hosted-runtime-log-database.md` | Dedicated hosted runtime-log Postgres ownership, deletion fence, retention, migration preflight, and rollback floor. | Hosted runtime observability storage | High | 2026-08-07 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-05-13 |
| `docs/incident-response.md` | Canonical incident.io-backed runbook for declaring, coordinating, communicating, resolving, and learning from Murph production incidents, including the `status.withmurph.ai` setup contract. | Incident coordination and public status policy | High | 2026-08-05 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-08-05 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/strategy.md` | Internal product north star for making member-valued health progress radically easier through progressively complete context, connected evidence, useful action, authorized proactive support, and delight. | Current product strategy | High | 2026-07-15 |
| `agent-docs/PRODUCT_SENSE.md` | Current product posture for a broad personal health assistant, including immediate value, compounding context, consequential discovery, proactive support, composable primitives, first-visit personalization, conversation-first control, channel-native Telegram and iMessage presentation, uncertainty-aware profile/contact speaker labels, public product-link sharing, pre-save capacity disclosure, and product guardrails. | Current product behavior | High | 2026-08-11 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules, including selective proactivity and progressively deeper member-controlled context. | Product principles | High | 2026-07-15 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`, including design-system sources (`PRODUCT.md`, `DESIGN.md`), model-neutral implementation routing, required component/section catalog updates, desktop/mobile PR screenshots, browser proof, preliminary ReviewGPT frontend review, and completion-workflow routing. | Current frontend implementation guidance | Medium | 2026-07-22 |
| `agent-docs/product-marketing-context.md` | Product marketing context for Murph as a broad personal health assistant, with honest fact/strategy/hypothesis/target-state labels, longitudinal-context and proactivity differentiation, delight, private-first onboarding, optional social support, and experiments as one primitive. | Product/marketing decisions | High | 2026-07-15 |
| `agent-docs/user-interviews.md` | User-interview kit for testing first useful threads, longitudinal context value, follow-through, primitive selection, and optional social support without leading the participant. | User research method | Medium | 2026-07-12 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails and failure-mode expectations, including capture-before-detach, source-version-fenced personal-to-group health projection with foreground scope preemption, server-deadline and transport-margin effect ownership, retained device retry ownership, and bounded composed fanout; exact pre-`BEGIN` pending-group payload-root preparation with authenticated-malformed-only retirement, exact pre-`BEGIN` Starter activation-root prewarming with bounded stale-authority retry, in-flight pending-group line recovery, trusted private-image attachment metadata, shared exact-message reply/reaction targeting, assistant-runtime-owned operation-local plus bounded private file-backed Linq speaker-label caching, generated-voice transcript fallback ownership with stable provider-effect identity, bounded hosted managed-automation reconciliation with audience-owned member/group seeds and immutable-id silent maintenance policies, deterministic reminder-availability pre-expiry wakes and foreground-preemptible provider reads, transaction-atomic group-share grant and projection-maintenance admission with scheduled mailbox recovery and explicit pending reads, retry-owned Stripe usage-credit fulfillment with frozen-policy saved-card recovery across authorized targets, status-only stale-amount conflicts, payer-and-target-scoped session-stable lost-response recovery, retry-owned group-sponsorship celebration with route and authority rechecks, terminal-action-owned metadata-only best-effort Stripe failure alerting with recovered diagnostics kept silent, beneficiary-serialized indexed 32-slot grant settlement and admission with exact provider-final reservation release and final reversal-capacity validation, post-commit referral reward reconciliation and runtime rechecks, bounded assistant outbox retries, interactive Messages-extension response-card rendering with a provider-static fallback and physical-device visibility gate, hosted Telegram rich routine-card authority and single-message fallback ownership, durable text-only native iMessage app-card rejection fallback with one effective in-flight/replay identity, non-affirmative Linq group-reaction root-prepared mailbox appends, durable failure-only fallback log entries, one trusted provider reply-thread binding, authorized stale-thread recovery, and ambiguous-delivery suppression, stale signup-welcome retirement, the one-reader Assistant Ask lane with post-Temporal direct latency hints, safe pre-checkpoint accepted-input completion admission and output-only caller continuation, deterministic unavailable copy, and server-expiry-bounded scheduled same-turn polling, bounded no-retry Labs discovery, the bounded day-key-idempotent internal product-feedback digest with same-hour retry, bounded in-turn private support escalation with stable stored-detail replay and capped email, time-indexed hosted-runtime latency candidate admission with exact hydration, Cloudflare container/Durable Object direct-RPC call discipline, hosted device-sync canonical schedule-event/mailbox-item identity with bounded at-least-once read replay and completion-fenced cadence, attempt-owned mailbox-canonical automatic meal-photo ingestion with member-wide accepted-capture engagement, a retryable managed-closeout postcondition, fail-closed canonical photo retirement, generated-image per-capture retirement with dormant-snapshot re-arm, run-frozen Clinical Records all-24 query activation and query-slice protocol compatibility, and single-region ENAM R2 ownership with fail-closed deploy metadata validation. | Runtime reliability policy | High | 2026-08-14 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, and escalation rules, including ambient app-session-bound Privy reauthentication and management-read, exact-transition Settings account linking, the hosted-web origin-only referrer boundary for telemetry, scripts, and the fixed public incident.io status-summary read, fixed-catalog one-time usage-credit Checkout plus current-policy saved-card personal, Family, and group PaymentIntents with explicit payer action available independently of current capacity, stale-amount keys confined to non-creating recovery, and authenticated payer-and-target-scoped session-stable explicit reauthorization, terminal-action-only Stripe failure alert classification, participant-authorized purchase-bound group sponsorship content, current-sender-bound usage-referral authority, verified Stripe-event purchase grants, and server-owned referral grants, root-turn-only invocation route/device authority, opaque accepted-message refs with effect-time authority revalidation, callback-bound private-person versus synthetic-room personalization, accepted-input and current non-direct Linq route authority, route-bound profile/contact speaker labels with unregistered-phone fallback but no identity or effect authority, native read-only Assistant Ask confinement with exact requester-participant identity and payloadless post-Temporal direct wakes, membership-bound return authority, and bounded opaque failure correlation, exact-grant group-to-member disclosure with one outgoing reviewer, output-only caller-group composition from bounded reviewed input, scheduled group-tool factory initiation, and server-expiry-bounded same-turn polling with independently authorized ordinary-turn tools, the web-owned read-only Labs provider boundary, fixed-count internal product-feedback digest disclosure, explicit verified-private support-escalation authority for one bounded de-identified written issue with reserved-prefix fail-closed routing plus anonymous digest and retention ownership, accepted-input authority for low-risk hosted assistant configuration, automatic meal-photo least-privilege, capture-level consent, access-checked direct-route resolution, and receipt-checked retained-photo cleanup, the signed payload-free hosted runtime owner-release callback, Cloudflare deploy Blacksmith secret access, Worker-owned hosted provider/generated-image credentials with finite-concept focused and legacy-batch Exa input, runner-scoped OpenAI egress credentials, protected Junction wearable-canary and retired-login scrub boundaries, companion account admission with capacity-gated iMessage welcome, no-line activation, Web-only welcome email, and exact pending-activation runtime-wake retry, web-owned Retell phone-call credentials, hosted Linq first-contact admission fail-open plus deploy-skew-safe ignored raw-text compatibility column and duplicate-safe decision policy, hosted computer-use Kernel/browser secret handling plus Managed Auth provider-writer, serialized mailbox-sequence reply boundary, group-local advisory room-model handle retention without identity or permission authority, capability-rotation, and suspended-owner cleanup-fence ownership, Composio connected-app authority with bounded structured provider-code logging plus fixed web-owned OpenWeather official-alert authority, strict query-scope and slice binding for Clinical Records page authority, and the scheduled six-field companion overnight-PRV boundary with forbidden raw data, passive-resume fencing, one connection/night admission, bounded retention, canonical acknowledgement, and physical validation gates. | Security policy | High | 2026-08-13 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/2026-07-23-connected-source-launch-gate.md` | Connected-source permission assumption, launch status, and ongoing provider controls. | Connected-source release gate | High | 2026-07-23 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-07-16 |
| `agent-docs/product-specs/imessage-workout-tracking.md` | Canonical workout-backed live session cards, closed generic/workout payload shapes, bounded positional V4 native wire encoding, display-to-canonical coordinate reconciliation, member-entered actuals, fail-closed explicit commands, immutable native and stateless image snapshots with the canonical Murph badge, bounded workout provider chrome with semantic text recovery, channel-neutral continuation copy, deterministic wrapped-raster sizing, privacy boundaries, persisted-owner rollback floors, and reader-first release gating. | iMessage workout product spec | High | 2026-08-11 |
| `agent-docs/product-specs/bring-your-own-inference.md` | Personal custom inference contract covering verified member-owned endpoints, explicit selection, no silent fallback, privacy, metering, and recovery. | Hosted assistant/custom inference product spec | High | 2026-07-31 |
| `agent-docs/product-specs/measured-biomarker-index.md` | Curated measured-biomarker navigation over preserved private lab history, including explicit admission, alias, and disclosure-layout contracts. | Biomarkers product spec | High | 2026-07-20 |
| `agent-docs/product-specs/personal-patterns.md` | Private repeated action-to-next-day sleep and recovery clues, including existing-history reuse, comparison matching, evidence stages, thresholds, refresh behavior, and ownership. | Personal Patterns product spec | High | 2026-08-10 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/starter-usage.md` | Non-expiring $4.50 starter usage on the immutable usage-credit ledger, including exactly-once enrollment, full-grant-plus-debit legacy migration, paid conversion boundaries, the completed 69-object legacy provider drain, removed checkout-time cleanup, bounded delayed-Stripe compatibility, and the two-plane forward-only Web/runner cutover. | Hosted access/billing product spec | High | 2026-08-11 |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Edge-to-Pulse renewal switches plus the web-owned hosted assistant configuration and personalization resolvers, including gated OpenAI/Venice core-provider choice, the fully deployed input-bound-only model/reasoning update contract, personal Luna/Terra choices, billing-gated Sol, relation-derived group-chat Sol with room-scoped Luna/Terra/Sol selection and fixed provider/reasoning, conversation style controls, the enforced composed included-plus-credit usage boundary with separate group funding, and the one-time durable-workflow recheck rollout. | Hosted billing/current-state spec | High | 2026-07-30 |
| `agent-docs/product-specs/hosted-plan-usage.md` | Web-owned enforced overall AI-usage projection with price-derived paid allowances and generic purchase/referral credit folded into one Settings percentage, internal forecasts that may threshold actions without displaying estimated days remaining, prospective $7.50 group-thread limits, automatic-recovery-aware link-free group continuity heads-ups framed as Murph time, one exhaustion recovery contract with a first-party link, accepted-message-bound responding-sender earned and funding follow-up options, explicit-request subscription quotes and personal top-up navigation, Stripe-owned immediate plan confirmation with signed-out return recovery and duplicate plan controls suppressed until webhook projection catches up, exact authorized Family owner-self navigation, the private accepted-input-bound subscription action surface, and the strict two-plane forward-only Starter Web/runner cutover. | Hosted billing/current-state spec | High | 2026-08-10 |
| `agent-docs/product-specs/hosted-group-member-plan.md` | Private $3.50 Core subscription for confirmed hosted-group members, including its internal Group billing identity, Pulse runtime mapping, price-derived allowance, signed private actions, and public-checkout exclusion. | Hosted billing/product spec | High | 2026-08-08 |
| `agent-docs/product-specs/labs-discovery.md` | Implemented read-only lab catalog and ZIP collection-site discovery through private Murph and the authenticated unlinked Labs page, with provider-neutral member-facing language. | Hosted Labs product spec | High | 2026-07-16 |
| `agent-docs/product-specs/hosted-usage-topups.md` | Durable hosted usage-credit contract: usage credit without message estimates, bounded indexed 32-slot settlement/admission and exact provider-final release, truthful structured capacity-conflict checkout UX, one-time personal and Family top-ups, immediate group funding controls at every capacity with same-route private sponsor management, direct funding requests without referral detours, automatic-refill-aware low-capacity urgency and setup-independent exhaustion recovery, low-capacity-only deterministic exact-$5 automatic refill admission, post-commit saved-card dispatch, Stripe-only grants, no funding-setup field in assistant group usage, quiet-by-default group contributions, explicit participant-authorized message/poem/15-second-song formats, malformed creative-envelope omission that preserves running-bit activation and settlement, strict generated-song media fidelity without text fallback, and pre-feature generic notes constrained to plain messages with later refills silent. | Hosted billing/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/hosted-usage-referrals.md` | Conversational personal/group usage missions with explicit arming, portable Linq/Telegram qualification, canonical credit-entry accounting, final rewards, privacy-safe source celebration, exact direct-route authority, and runtime-owned exact legacy-notice recovery. | Hosted growth/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/physical-notes.md` | Expressive GPT Image artwork mailed through one Lob effect, with end-to-end HTTP-ambiguity preservation, one bounded same-key transport replay that preserves first-attempt ambiguity on replay failure, row-scoped provider recovery across base-admitted multiple-unresolved states, atomic blocker settlement, resolved-versus-unresolved replay boundaries, member-wide unresolved-effect guards, replay-safe reconciliation, member/group complimentary claims, and ordinary Murph usage. | Hosted physical-note product spec | High | 2026-08-12 |
| `agent-docs/product-specs/hosted-support-escalation.md` | Background-first product-failure feedback, opt-in support-address disclosure, and one-turn reserved escalation after an explicit verified-private human-support request, with Murph's bounded sanitized issue in its own words, explicit residual semantic-risk ownership, truthful completion copy, immediate alerts containing the validated stored issue and internal ids, explicit digest and anonymous-retention ownership, a three-email-per-UTC-day server limit, stable provider idempotency, and archived review-history routing. | Hosted support product spec | High | 2026-08-05 |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted Family plan for 2-6 sponsored people, mixed Pulse/Edge member assignments, exact owner-funded member usage top-ups, webhook-owned capacity, private member accounts, chat-first invites, bounded legacy trial conversion, and privacy boundaries. | Hosted billing/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/health-commons.md` | Health Commons product boundary for wiki-like pages, build-time catalog generation, runnable-protocol publishing and withdrawal, exact page/run-spec Start identity, terminally immutable withdrawn private-run lineage, scoped runtime artifacts, future aggregate outcome summaries, revisions, and artifact manifests. | Health Commons behavior | High | 2026-07-29 |
| `agent-docs/product-specs/murph-safe-public-product-search.md` | Murph Safe public supplement and branded-food evidence search, normalized public API, exact test-linkage rules, privacy, and abuse bounds. | Public product evidence behavior | High | 2026-07-16 |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Health Commons protocol card copy | High | 2026-04-30 |
| `agent-docs/product-specs/murph-onboarding.md` | Aspiration-anchored new-member onboarding contract for a private broad-assistant relationship, including a compact progressive-disclosure skill router, observable bounded-history forward-progress inference, brief aspiration-thread capture, explicit park, progressive health foundation with an immediate three-child memo split, separate start acknowledgement, modality-matched lab closer, contextual return, collaborative first step, text-only launch close, and finite completion. | New-member onboarding behavior | High | 2026-08-06 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment-only onboarding boundary for exact Health Commons start intents, title-only unavailable-start recovery, withdrawn-protocol recovery without in-place or post-terminal lineage replacement, baseline policy, saved-run timing ownership, safety/setup flow, capturable session outcomes, bounded assistant support, deterministic closeout, and trusted private progress-card handoff. | Experiment onboarding behavior | High | 2026-07-30 |
| `agent-docs/product-specs/experiment-adherence-confidence.md` | Read-time assumed adherence, confidence ladder, correction semantics, category-scoped activity evidence, and typed subjective session evidence for experiments. | Experiment adherence behavior | High | 2026-07-16 |
| `agent-docs/product-specs/experiment-outcome-selection.md` | Experiment-only selection rules for member-valued and capturable outcomes, credible evidence, typed session metrics, timeframe integrity, and setup handoff. | Experiment outcome selection behavior | High | 2026-07-16 |
| `agent-docs/product-specs/protocol-outcome-network.md` | Protocol outcome network boundary for private outcome cards now and future sharing, contribution, cohort summaries, and social guardrails. | Outcome network behavior | High | 2026-05-13 |
| `agent-docs/product-specs/captures.md` | Capture primitive product boundary for dated private media evidence, durable user-authored media, and 14-day generated-image payload retention with mandatory lookup materialization, checkpointed deadlines, replay-blocking tombstones, and lookup-backed generated-origin recovery that still requires outbox delivery proof. | Capture behavior | High | 2026-08-10 |
| `agent-docs/product-specs/companion-app.md` | Native iOS and Android health companions: canonical account admission with a capacity-gated first iMessage, no-line activation and managed-line inbound-first recovery, Web-only welcome email, exact pending-activation runtime-wake retry, broad Apple Health sync, closed WHOOP enrichment, scheduled overnight PRV on iOS, and a narrow Health Connect bridge on Android. | Companion app plan | High | 2026-08-13 |
| `agent-docs/product-specs/query-metric-universality.md` | Universal metric queryability invariant: every metric-bearing canonical event yields a query metric point through the generic extraction rule. | Query metric product spec | High | 2026-07-22 |
| `agent-docs/product-specs/companion-app-mvp.md` | Two-screen companion build spec plus bounded WHOOP metadata enrichment and the strict scheduled six-field overnight-PRV beta: one-time enrollment, constant-memory five-minute windows, protected scalar recovery, one immutable nightly summary, metric separation, bounded retention, and deployment/physical-validation gates. | Companion app build plan | High | 2026-07-14 |
| `agent-docs/product-specs/ios-address-book-advisory-names.md` | Optional iOS Contacts projection with bounded one-to-four-label alternatives, member-scoped KMS MAC tokens, encrypted advisory labels, route-authorized iMessage/SMS roster lookup and sender attribution with one hosted-group access workflow, typed provider capability gaps, participant-access reconciliation, CAS deletion/retention, residual threat model, and rollout order. | Companion/group privacy contract | High | 2026-07-30 |
| `agent-docs/product-specs/habitat.md` | Habitat progressive member life-context: domains, `habitat` bank family, domain catalog, coverage derivation, context-dividend collection rules, environment/workspace v1 indicators, and bounded Environment voice-to-Browser-Vault replica convergence and recovery. | Habitat product spec | High | 2026-08-11 |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step with member-chosen contact-card avatar, independent from `/home` first-visit personalization. | Contact-card picker spec | Medium | 2026-07-22 |
| `agent-docs/product-specs/murph-personas.md` | Six base personalities, 36 premade ordered combinations, direct `/home` first-visit picker ownership, combination-id persistence, main-owned voice/tone defaults, legacy read normalization, and six-set preview ownership. | Murph persona behavior | High | 2026-07-22 |
| `agent-docs/product-specs/murph-tone-and-voice.md` | Conversation-first contract for the persona baseline plus hosted Tone, Voice, Humor, Push, Detail, and the conversational-only Unhinged dial across first-visit personalization, private Murph, and synthetic room runtimes, including accepted-input and current-Linq-route authority, personal Settings convergence, room-owned group controls, the running-turn voice-memo default plus explicit current-user named one-off override, per-dial projection and canonical companion watermarks, exact-successor compound message batches, sparse web projection, per-setting causal ordering, shared owners, prompt behavior, the same-turn read plus bounded step for a bare directional request, the group shared-dial buy-in rule for Unhinged, and rollout and rollback floors. | Murph speaking-style preference spec | Medium | 2026-08-10 |
| `agent-docs/product-specs/shared-message-targeting.md` | Shared opaque accepted-message reference, authority resolver, native-reply marker, reaction reuse, provider behavior, and immediate runner rollout contract. | Assistant messaging behavior | High | 2026-07-16 |
| `agent-docs/product-specs/group-chat-social-dynamics.md` | Human-first group-chat psychology, conversational-floor ownership, prompt-owned 8+6-second reply cadence with mid-pause safety/floor re-evaluation, one-bubble interactive replies, setup-to-human handoff, arrival-to-resident tapering, participation boundaries, comedy authority, and brief public-reference grounding for earned playful turns. | Group conversation behavior | High | 2026-08-09 |
| `agent-docs/product-specs/group-managed-automations.md` | Implemented member/group managed-owner isolation, execution checks, and retirement behavior; no member-facing group social automation currently ships. | Managed group automation behavior | High | 2026-07-26 |
| `agent-docs/product-specs/group-health-newsletter.md` | Newsletter as a private skill recipe over an ordinary wall-clock-aware group automation, consent-aware shared reads, normal current-chat delivery, and an optional generic group-email effect with Web-owned recipient revalidation and existing-outbox durability. | Group newsletter behavior | Medium | 2026-08-10 |
| `agent-docs/product-specs/group-challenge-formats-and-scorecards.md` | Individual, team, and collective challenge formats plus one-to-five model-interpreted additive components with deterministic point arithmetic and aggregation. | Group challenge scorecards | High | 2026-07-29 |
| `agent-docs/product-specs/group-challenge-data-diagnostics.md` | Truthful complete or partial group-challenge standings, evidence-ordered missing-data guidance with explicit first-projection `pending` versus completed-empty `missing` states, group-authorized fresh exact-scope reads, source-tagged multi-source health shares without cross-source selection, rollback-readable legacy sleep compatibility, and connection/source-epoch-coherent privacy-bounded `device-sync-status.v0` observations. | Group challenge diagnostics | High | 2026-08-13 |
| `agent-docs/product-specs/challenge-standings-card.md` | Native Messages presentation contract for individual, team, and collective challenge standings with truthful partial and unscored states, authenticated Linq group-only delivery, complete semantic captions, and an identity-free static-image projection with the canonical Murph badge. | Group challenge standings response card | High | 2026-08-11 |
| `agent-docs/product-specs/personal-group-awareness.md` | Personal Murph read access to the member's hosted-group memberships, requested permissions, active self grants, and owner-authorized permission links. | Hosted group self-awareness | High | 2026-07-10 |
| `agent-docs/product-specs/private-group-consultation.md` | Implemented Assistant Ask request/reply primitive, first composed as an automatically resolved, read-only private-to-group Murph ask, with exact requester identity, deterministic exact unavailable delivery, bounded foreground-causal draining, bounded opaque failure correlation, and post-Temporal direct latency hints. | Hosted group consultation | High | 2026-07-26 |
| `agent-docs/product-specs/consented-group-disclosure.md` | Exact-grant group-to-member Assistant Ask composition with Like consent, a private read-only candidate, one fresh outgoing allow/deny review, exact-message current-sender authority, pre-checkpoint accepted-input completion admission, audience-neutral output-only caller-group composition, ordinary scheduled group initiation with live-authorized same-turn polling and no second provider turn, and the hard-cut no-producer-flag rollback floor. | Hosted group disclosure | High | 2026-07-29 |
| `agent-docs/product-specs/hosted-group-join-confirmation.md` | First-join private Murph confirmation with a sanitized group name, deterministic web or reaction copy, first-party sharing-editor link, and one durable member-row owner for Linq routing, activation, invite, and mailbox writes. | Hosted group membership behavior | High | 2026-07-23 |
| `agent-docs/product-specs/clinical-records-intake.md` | Epic SMART clinical-record connection, exact API-registration catalog, all-24 primary query activation across 17 permissions, provider-directory, credential/control-plane, query-slice-bound retrieval, raw-first vault import, privacy, recovery, and rollout contract. | Clinical Records intake behavior | High | 2026-07-21 |
| `agent-docs/phone-calls/retell-phone-agent.md` | Retell hosted phone agent prompt, authority, transfer, and call-brief handling rules. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/phone-calls/retell-analysis-fields.md` | Retell post-call analysis field contract and transcript-retention boundary. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/feature-user-story-audit/README.md` | Feature user-story audit overview and artifact inventory. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/gap-triage.md` | Triage notes for gaps found during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/parse-warnings.md` | Parser warnings captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/testing-errors.md` | Test errors captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/testing-ci-map.md` | Verification map for packages, apps, smoke flows, PR-CI ownership and acceptance-parity guards, optional local diff diagnosis, mandatory pre-direct-default acceptance, canonical executors, and current coverage surfaces including Environment voice replica convergence and contiguous Browser Vault refresh-control collapse, real-PostgreSQL device-sync reconnect retention, consent-ordering, reconnect/acknowledgement lock-order proofs, companion Starter enrollment with a routable welcome line, without an assignable line, and at proactive capacity, bounded indexed usage-credit settlement, provider-final reservation release, reversal-capacity validation, the protected-main live Junction WHOOP canary with its frozen-workspace Codex CLI PATH preflight plus operator-run Oura browser proof, App Router-inclusive spread-free Stripe request enforcement and the safe test-mode resume contract probe, workspace-checkpoint CAS and mailbox-acknowledgement atomicity, physical-note one-effect PostgreSQL concurrency, reminder-availability cadence and foreground-preemption proof, authenticated Linq speaker-label batching plus bounded edit preparation/KMS composition and real-PostgreSQL three-contender proof, bounded file-cache behavior, the exact-count local device-sync database-spike and one-set-read maximum-cardinality runtime-apply replays, deterministic hosted device-sync durable-identity, bounded at-least-once replay, completion-fence, and quiescence proof, one-turn private support escalation and detailed alerts, the internal product-feedback digest, the hosted-runtime latency candidate plan/cardinality proof, and the Clinical Records callback/account-deletion real-PostgreSQL concurrency proof. | Testing and CI truth | High | 2026-08-14 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-runtime-protocol.md` | Hosted mailbox/workspace checkpoint protocol, including trusted generated-image attachment metadata, exact-id ready-completion admission and provider-acceptance-owned wake retention ahead of already-waiting conversation input in one Codex batch, generated-delivery reader-first rollout, exact flat runtime staging, permission adoption, quiescent cleanup, and rollback-floor sequencing; shared accepted-message targeting and its runner rollback floor; exact-scope current shared-data reads with transaction-atomic projection handoffs, scheduled retryable maintenance-row recovery, source-query null-cursor first-materialization pages bounded to 25 exact replacements with prompt continuation and foreground gaps, opaque grantor- and destination-inactivity deferral, fresh reaffirmation generations, bounded legacy generation backfill, member-local seven-date consent bounds, explicit pending snapshots, capability-safe deferred projection obligations, consumer-first rollout, immediately available reported sleep stages, coherent single-generation device-source observations, checkpoint-gated consented vault-share projection fairness with complete device-only deferral, capture-before-owned-delivery, retained end-to-end delivery ownership with nonblocking foreground admission, retained failure/preemption ownership, source-workspace stale-writer fencing, high-water-complete dirty-only deferral, budget-continuation priority, and immediate shutdown handoff, plus device-sync canonical schedule-event/mailbox-item identity with bounded at-least-once read replay, completion-fenced cadence, and quiescent later recovery buckets; authenticated Linq group speaker-label provenance, unregistered-contact fallback, operation-local and bounded private file-backed caching, parser-compatible rollout, signed payload-shape compatibility with redacted diagnostics, and iMessage app fallback minimization plus mode-independent first-contact disposition; the paired hard-cut Assistant Ask mailbox lifecycle with exact requester identity, deterministic exact unavailable delivery, post-Temporal direct latency hints and post-enrollment instant-start foreground prewarm with conversation-first deferred activation signaling and provider-dependent crash-window recovery, pass-wide joined-group request and accepted-input completion pre-checkpoint admission, pass-owned fresh-input occurrence ordering plus a read-only complete-index fallback, natural answer continuation or exact unavailable notification through existing output-only delivery surfaces, provider-accepted and replay-safe current-sender private exact-completion imports that preserve the logical direct session while invalidating stale native resume, bounded failed-request correlation, plus exact-grant group-to-member asks and exact-message current-sender authority with output-only caller-group composition or live-revalidated scheduled same-turn polling and no producer flag; exact all-resident proof for up to three per-root one-shot children, including one detached read-only candidate plus one outgoing disclosure reviewer, beside the serial foreground writer; serialized cross-lane preference causality with field-scoped replay handling and active person-or-room wake recovery; signed email reply-alias ingress; runtime write-fence authority and direct exact-abort background-mode preemption for foreground priority with platform/control-plane stop reconciliation; latency-neutral stale-fence classification, same-call timing diagnostics, coherent concurrent-replacement attribution, and attempt-scoped R2 response-header/body-consumption restore timing; checkpoint, restore, and owner-release sequencing; provider egress, including explicit group-access offer publication and active-offer dedupe; mailbox import; provider-visible ordinal-bounded active-turn targeting; and durable wake ownership. | Hosted execution architecture | High | 2026-08-14 |
| `agent-docs/references/hosted-temporal-orchestration.md` | Durable hard-cut Temporal orchestration ADR defining final ownership split, private Murph Cloud production worker, deployment, prior-private-version rollback ownership, and repository-relocation replay continuity, pointer-only Temporal state including the payload-free runtime wake used by provider changes and the same-transaction durable maintenance-mailbox handoff used by new group-share grants, signal-aware retry/wait behavior including failed-runtime completion backoff, web signal-client and worker Temporal Cloud auth/TLS parity, callback-signed execution-adapter and device-sync scheduled wake sweep contract, web-owned reconciliation facts without Activity-local signed usage decisions, post-start exact-code AI-usage denial as an unchanged mailbox prefix with durable lag preserved, mailbox-lag priority, global device-sync scheduled-wake Schedule ownership with bounded mailbox handoff, production Workflow bundle, cache-memory, fixed execution-slot and autoscaling-poller limits, two-instance Render capacity, Cloudflare scheduler deletion targets, Vercel Workflow nudge deletion targets, architecture guard coverage, and acceptance criteria; `agent-docs/exec-plans/completed/TEMPORAL.md` is the completed execution snapshot. | Hosted Temporal orchestration target | High | 2026-08-11 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Paused giant-file cleanup planning guidance and current worth-planning/keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-06-03 |
| `agent-docs/research/2026-08-13-alternating-routine-set-resolution.md` | Privacy-safe production correlation and root-cause analysis for repeated strength-set completions attributed to the wrong exercise in an alternating routine. | Investigation artifact | Medium | 2026-08-13 |
| `agent-docs/research/2026-08-05-ios-android-companion-parity-audit.md` | Point-in-time exhaustive crosswalk of landed Murph iOS companion pull requests against Android main, with confirmed product, correctness, health, contact, release, and verification gaps plus platform-specific exclusions. | Mobile companion parity audit | Medium | 2026-08-05 |
| `agent-docs/research/2026-07-16-codex-session-architecture-audit.md` | Point-in-time aggregate evidence from the frozen 30-day Codex session audit, including corpus coverage, change-mapping dispositions, steering themes, and confidence limits. | Architecture audit research artifact | Medium | 2026-07-18 |
| `agent-docs/research/2026-07-10-junction-labs-commerce-and-fulfillment.md` | Point-in-time Junction lab-ordering research and phased product, commerce, fulfillment, result-import, and launch-gate proposal. | Research and future planning artifact | Medium | 2026-07-10 |
| `agent-docs/research/2026-06-25-imessage-line-flag-evidence.md` | Point-in-time redacted evidence note for the 2026-06-25 iMessage line flag investigation. | Investigation artifact | Medium | 2026-06-26 |
| `agent-docs/research/murph-age-autoresearch.md` | Murph Age autoresearch operating rules, including the ReviewGPT-vs-Codex role split, transition gates, and source/privacy boundaries. | Murph Age research workflow | High | 2026-05-09 |
| `agent-docs/operations/agent-workflow-routing.md` | Workflow router and compact agent work contract for task classes, action authority, evidence/tool use, progress updates, plans, required edit-task Frog inspection and qualifying friction logging with tracked plan-file edits included and same-task commit ownership, focused local PR proof with exact-head CI ownership, current-base merge-tree readiness with one base update maximum and a terminal moving-base-race stop, frontend-only final-gate exemption, behavior-preserving base-conflict rerun exemption, parallel same-head specialist/final ReviewGPT routing, one acceptance run plus a bounded post-acceptance rebase for direct-default pushes, commit paths, worktree isolation, and safe retirement. | Agent workflow routing | High | 2026-08-11 |
| `agent-docs/operations/verification-and-runtime.md` | Verification ownership by delivery path: focused local proof plus broad exact-head CI for PRs, required-check-only merge waiting, current-base merge-tree readiness with one base update maximum and a terminal moving-base-race stop, evidence-driven local CI diagnosis, one acceptance run plus a bounded unchanged-patch post-acceptance rebase for direct shared-default pushes, canonical command and executor semantics, protected-main live Junction WHOOP canary proof with independently owned Codex pins visible to review, runtime proof boundaries, private Temporal worker/deploy/rollback ownership, required live proof for user-facing Telegram presentation changes when an ignored local preview target is configured, required repo-local Playwright fallback for unattached browser proof, and package/app testing surfaces including the internal product-feedback digest. | Verification policy | High | 2026-08-11 |
| `agent-docs/operations/database-transaction-starvation-audit.md` | Point-in-time production catalog at its exact audited base covering interactive transactions and explicit locks, starvation classifications, retained-lock evidence policy, replacement patterns, PR ordering, and privacy-safe observability. | Database critical-section reliability | High | 2026-08-09 |
| `agent-docs/operations/typescript-verification-performance.md` | TypeScript 7 worker budgets, optional local canonical verification with explicit Crabbox-on-Blacksmith escalation and an exclusive heavyweight lane, focused PR proof, direct-default acceptance, scoped diff and repo-tools caps, incremental CI state, editor/watch guidance, and benchmark method. | Verification performance policy | Medium | 2026-07-29 |
| `agent-docs/operations/completion-workflow.md` | Outcome-based completion bar with same-PR changelog classification through `$write-changelog`, production-owner checks for factual visuals and independently selectable consent scopes, exact invocation-route, audience, authorization, destination, and recovery checks for asynchronous claims, and silent-feedback plus bounded-redaction truth checks; focused local PR proof; exact-head GitHub Actions as the broad PR gate; clean current-base merge-tree readiness with required-check-only waiting, one base update maximum, and a terminal moving-base-race stop; one acceptance run plus a bounded post-acceptance rebase for direct-default pushes; required repo-local Playwright fallback before browser-proof blockers; objective coverage-review admission; frontend-only final-gate exemption with preliminary UI lenses preserved; same-head parallel preliminary/final ReviewGPT starts with independent resolution state; risk-and-size-aware later-round full-audit versus correction-delta selection; plan/commit closure including same-task Frog entries; PR intent; hot-reply-path and database-collection-fanout impact; complete individual/group initial provider-input token and byte impact with prompt/tool/generated-guidance attribution; change-shape contracts; and merge-readiness handoff. | Completion workflow | High | 2026-08-11 |
| `agent-docs/operations/imessage-deliverability.md` | iMessage/SMS deliverability guidance for assistant prompts, outbound copy, exact-message targeting, inbound-triggered daily home-line redirects with a one-hundred-message explicit-resend bank, reminders, member-owned current-home routing, daily line limits, notifications, line health, pacing, links, cold-contact behavior, outbox-owned interactive response cards with provider-owned outer chrome, a provider-static raster carrying the canonical Murph badge and native-visible hierarchy, neutral incomplete nutrition progress, and a physical-device visibility gate, first-rate-limit and complete-response 2.5-second capability-deadline fallback, durable failure-only fallback log entries, classified stale-app-card recovery under the promoted identity, one trusted provider reply-thread binding, invocation-local late-input delivery context without durable recipient exposure, bounded offline V1-V5 fragments, offline native decoding, one effective text-fallback identity across provider entry, authorized stale-thread recovery, replay, and ambiguous-delivery suppression, the one-hundred-message group outreach bank, provider-native authoritative group-signup reply identity and accepted-day suppression, conversation-first instant-start activation signaling with request-local failure handling and provider-dependent crash recovery, member-wide accepted meal-capture engagement, and blocked-model system-import admission. | Phone-number messaging policy | High | 2026-08-11 |
| `agent-docs/operations/local-storage-lifecycle.md` | Local Vitest temp-root ownership, abrupt-run stale cleanup, unmanaged temporary checkout ratcheting, automatic Spotlight exclusion for registered worktrees, and exact build-output cleanup rules. | Local rebuildable-storage lifecycle | High | 2026-08-10 |
| `agent-docs/operations/hosted-local-worktree-dev.md` | Hosted-local worktree dev workflow and helper spec for running `pnpm dev` from secondary worktrees without colliding with the main checkout's ports, database, local hosted crypto state, Wrangler state, Next dist dir, optional MinIO data, and webhook tunnel setup. | Local hosted runtime workflow | Medium | 2026-06-22 |
| `agent-docs/operations/pr-reviewgpt-loop.md` | Exact-head managed-browser completion workflow: one preliminary ReviewGPT pass combines product-experience/prompt/frontend/coverage lenses using focused local proof plus current CI status and may return a bounded coverage patch; frontend-only work skips the separate final cross-cutting gate unless another risk trigger applies; eligible final round 1 may start in parallel on the same head with an independent immutable baseline; behavior-preserving merge-boundary updates have a one-update budget, required-check-only waiting, and an explicit moving-base-race stop; one packager-owned head-bound decision makes later rounds re-send a full ZIP for sensitive, undeclared, or large PRs and otherwise send a same-thread correction delta only for explicitly routine small PRs; an explicitly requested new full-audit conversation requires the prior-finding ledger; the loop has a seven-round hard cap before explicit continuation is required. | PR ReviewGPT loops | Medium | 2026-08-11 |
| `agent-docs/operations/device-sync-ingestion-invariants.md` | Device-sync push/pull ingestion invariants, Junction aggregate-cadence and per-source recovery ownership, hosted connection-binding plus `connectedAt` epoch supersession of fetch/control work while accepted credential-independent import carriers remain durable through a persisted server classification bit, private store-owned or consent-ordered payload preparation with a two-resource built-in webhook cap, shared-root fresh replanning and a provider-closed final transaction, marker-before-payload reconnect cleanup, payload replay with local-scheduler backoff, and companion-only scheduled overnight-PRV admission with explicit connect/passive-resume authority, immutable nightly identity, bounded local scalar recovery, and SDNN/Recovery separation. | Device-sync ingestion contract | High | 2026-08-12 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules. | Plan workflow | Medium | 2026-03-31 |
| `agent-docs/exec-plans/completed/README.md` | Marks completed plans as immutable, non-operative historical snapshots and routes current implementation, deployment, rollback, and incident guidance to live owner docs. | Completed-plan archive interpretation | Medium | 2026-07-22 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/active/` | Task-owned in-flight execution plans, including the approved Telegram rich-routine implementation. | Active plan lifecycle | Medium | 2026-08-11 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/` | Reusable completion-review lenses and local audit prompts, including the preliminary ReviewGPT product-experience/prompt/frontend/coverage references, the frontend simplicity and Steve Jobs taste bar, and the fallback local deep-review prompt. | Workflow prompt library | Low | 2026-07-30 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke seam prompts governed by a shared review-only, evidence, correction, and zero-finding contract. | Seam-audit prompt library | Low | 2026-07-13 |
| `apps/web/README.md` | Hosted web control-plane overview, env/runtime contract, one-shot first-visit persona picker handoff, fixed-pack usage-credit Checkout plus capped monthly group authorization and explicit saved-card PaymentIntents, metadata-only Stripe failure alert configuration, canonical purchase/referral credit-entry ownership and remaining projections, conversational referral state, product-label database restore and constraint rollout order, gated OpenAI/Venice assistant Settings projection, signed conversation convergence, and cross-lane mailbox causal-sequence ownership, hosted AI usage allowance ownership, hosted computer-use run/handoff ownership, hosted Linq first-contact decision retention and iMessage app-fallback screening boundary, health-data revocation rollback floor, approval-read rollback floor, Temporal reconciliation-facts boundary, and app-source/testkit ownership split. | `apps/web/**` | Medium | 2026-08-09 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview and runtime contract, including payloadless direct Linq and Assistant Ask latency wakes, strict plan-usage consumer rollout order, Worker-owned provider egress allowlists, runner-scoped OpenAI and Venice egress credentials, asynchronous private generated-image delivery, and encrypted temporary group-avatar staging. | `apps/cloudflare/**` | Medium | 2026-07-29 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution, including the coordinated health-data revocation Web/Worker rollback floor, gated Venice provider activation, immediate runner rollout and rollback floors for shared message targeting, direct support escalation, and group room-model maintenance, hard-cut Assistant Ask and consented group disclosure rollback floors, group-funding urgency/capability rollout order, additive failed-request diagnostic rollout, native permission smoke, Blacksmith deploy handoff validation, private generated-image delivery and group-avatar staging, the approval-read web/runtime compatibility floor, the gated personality projection-convergence hard cut, and no signed usage-allowance start secret. | Hosted deploy flow | Medium | 2026-08-05 |
| `packages/assistantd/README.md` | Local assistant daemon boundary and control-plane contract. | `packages/assistantd/**` | Medium | 2026-03-30 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime surface consumed by Cloudflare, including bounded same-conversation exact-successor provider-turn batches, terminal input-id authority for Web-derived preference order, mailbox-causal assistant-preference application, and legacy pending-item replay. | `packages/assistant-runtime/**` | Medium | 2026-07-15 |
| `packages/device-syncd/README.md` | Local wearable sync runtime boundary and env contract. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/clinical-records/README.md` | Pure Clinical Records Intake contracts for raw FHIR retrieval manifests, deterministic FHIR source references, and upsert/retract/review import-plan decisions. | `packages/clinical-records/**` | Medium | 2026-07-10 |
| `packages/health-metrics/README.md` | Neutral MetricPoint contracts, health metric definitions, unit normalization, display formatting, and selection policy. | `packages/health-metrics/**` | Medium | 2026-05-02 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, generated-delivery ref ownership, hosted state rules, and hosted Codex rollout snapshot scope without ChatGPT auth portability. | `packages/runtime-state/**` | Medium | 2026-07-16 |
| `packages/vault-usecases/README.md` | CLI/headless vault usecase orchestration boundary over core, importers, and query. | `packages/vault-usecases/**` | Medium | 2026-05-02 |

## Conventions

- Keep this index focused on live docs that describe the current repo state.
- Do not list point-in-time architecture reviews, migration guides, or historical cleanup audits here.
- Keep current external compatibility references such as the device-provider compatibility matrix when they describe active planning or provider requirements.
- Update this index whenever canonical docs are added, removed, moved, or materially repurposed.
