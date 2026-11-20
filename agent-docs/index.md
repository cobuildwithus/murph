# Murph Agent Docs Index

A directory of the durable docs. Find the row for your task and read that doc;
`AGENTS.md` has the task router. Completed execution plans under
`agent-docs/exec-plans/completed/` are history, not instructions.

## Canonical Docs

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, public package posture, local/hosted runtime tiers, and verification entrypoints. | Current repository state | High | 2026-05-02 |
| `ARCHITECTURE.md` | Current runtime architecture: owners, boundaries and data flow for every app, service and package, including Ops reset eligibility and Progress sealed facts, share cleanup and consent, reader units, cited goals, per-person sharing revisions, unobserved Friends totals, background medal settlement, medal ordering and streak retirement. | Current runtime architecture | High | 2026-11-19 |
| `agent-docs/ARCHITECTURE_GUIDANCE.md` | Architecture planning guidance. | Architecture planning guidance | High | 2026-08-24 |
| `PRODUCT.md` | Strategic design context: register, users, Web Home setup and Settings, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system. | Visual design system | High | 2026-07-22 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, package-boundary hygiene notes, and hosted ownership baseline. | Current architectural baseline | High | 2026-05-13 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and cross-cutting invariants. | Canonical vault interface decisions | High | 2026-07-20 |
| `docs/contracts/06-hosted-workspace-file-count.md` | Hosted workspace checkpoint/restore and canonical receipt media recovery contract. | Hosted workspace checkpoint/restore contract | High | 2026-09-10 |
| `docs/device-sync-hosted-control-plane.md` | Junction-only hosted device control plane; companion ingestion, hosted agent sessions and source-labelled reads. | Device-sync architecture direction | Medium | 2026-09-08 |
| `docs/device-provider-contribution-kit.md` | Junction transport and source-normalization contribution boundaries. | Provider contribution workflow | Medium | 2026-05-13 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations. | Device-provider normalization planning | Medium | 2026-07-14 |
| `docs/hosted-auth-migration.md` | Four-stage Privy removal, reviewed candidate heads, merge/deploy order, transition-only import, session continuity, first-passkey and recovery sign-in factors, and guarded schema/vendor retirement. | Hosted auth migration rollout | High | 2026-11-16 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam, dormant block/leave rotation and per-epoch group evidence deletion. | Hosted contact-privacy rotation seam | Medium | 2026-11-15 |
| `docs/hosted-linq-db-home-lines-migration.md` | Database-backed Linq home-line assignment, provider inventory freshness, and bounded Serializable snapshot recovery. | Hosted Linq line ownership and rollout | High | 2026-09-11 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account vault/share-picture export and deletion, bounded private media reads, store coverage, and the canary retention exception. | Hosted account privacy workflow | High | 2026-11-16 |
| `docs/hosted-runtime-log-database.md` | Hosted runtime log database: what is recorded, the bounded diagnostics it supports, retention and deletion. | Hosted runtime observability storage and usage-profile diagnostics | High | 2026-10-10 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-05-13 |
| `docs/incident-response.md` | Canonical incident.io-backed runbook for declaring, coordinating, communicating, resolving, and learning from Murph production incidents. | Incident coordination and public status policy | High | 2026-08-05 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-08-05 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/strategy.md` | Current product strategy. | Current product strategy | High | 2026-07-15 |
| `agent-docs/PRODUCT_SENSE.md` | Product posture, account-only Web scope, member workspace troubleshooting, and complete unfiltered private workspace archives. | Current product behavior | High | 2026-09-17 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules. | Product principles | High | 2026-07-15 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`, including Home setup, Settings, retired Training and browser cache lifecycles, inert auth studies and isolated browser proof. | Current frontend implementation guidance | Medium | 2026-10-16 |
| `agent-docs/product-marketing-context.md` | Product/marketing decisions and account-only Web scope. | Product/marketing decisions | High | 2026-07-15 |
| `agent-docs/user-interviews.md` | User research method. | User research method | Medium | 2026-07-12 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability rules for retries, queues, ordering, idempotency, delivery and failure recovery across the hosted runtime. | Runtime reliability policy | High | 2026-11-02 |
| `agent-docs/operations/stripe-effect-compatibility-cutover.md` | Hosted billing operations. | Hosted billing operations | High | 2026-08-28 |
| `agent-docs/SECURITY.md` | Security constraints, custom MCP OAuth, gateway and passkey-confirmed write boundaries (phone- or Telegram-established accounts only), secret and auth rules, and escalation. | Security policy | High | 2026-11-16 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/2026-07-23-connected-source-launch-gate.md` | Connected-source permission assumption, launch status, and ongoing provider controls. | Connected-source release gate | High | 2026-07-23 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-07-16 |
| `agent-docs/product-specs/sleep-summary-card.md` | Host-built private nightly summaries, envelope 8, static rollout and wake-date selection. | Sleep card product spec | High | 2026-11-03 |
| `agent-docs/product-specs/nutrition-totals-card.md` | Logged-so-far nutrition cards without mandatory targets; invitation evidence, recovery, and native skew. | Nutrition card product spec | High | 2026-09-11 |
| `agent-docs/product-specs/imessage-workout-tracking.md` | iMessage workout product spec, verified editor attachment, and installed-client-compatible message/result transport. | iMessage workout product spec | High | 2026-09-08 |
| `agent-docs/product-specs/journal.md` | Native timeline and companion API, shared projection, connected plans, and spread morning reminder reconciliation; retired website timeline. | Journal product spec | High | 2026-11-18 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/starter-usage.md` | Non-expiring $4.50 starter usage on the immutable credit ledger, text entry, subscription access for Images and Responses HTTP/WebSocket generation, and abuse alerts; retained paid legacy compatibility. | Hosted access/billing product spec | High | 2026-09-11 |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Period-end plan switches, self-service scheduled-cancellation recovery, and web-owned assistant configuration and personalization resolvers. | Hosted billing/current-state spec | High | 2026-10-16 |
| `agent-docs/product-specs/hosted-plan-usage.md` | Hosted billing/current-state spec. | Hosted billing/current-state spec | High | 2026-08-18 |
| `agent-docs/product-specs/hosted-group-member-plan.md` | Private $3.50 Core subscription for confirmed hosted-group members. | Hosted billing/product spec | High | 2026-08-25 |
| `agent-docs/product-specs/labs-discovery.md` | Private conversational Labs discovery and retired browser entrypoints. | Hosted Labs product spec | High | 2026-07-16 |
| `agent-docs/product-specs/hosted-usage-topups.md` | Hosted billing/product spec, including 80% top-up usage grants, preserved historical purchase terms, and migration-first sponsorship compatibility. | Hosted billing/product spec | High | 2026-09-22 |
| `agent-docs/product-specs/hosted-usage-referrals.md` | Hosted growth/product spec. | Hosted growth/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/physical-notes.md` | Hosted physical-note product spec. | Hosted physical-note product spec | High | 2026-08-21 |
| `agent-docs/product-specs/ios-game.md` | iOS game group Prove it and pre-join Talk contracts, a missed day counted as a post in the player's own words, day corrections for 7 days after a pair game ends, off-day refusal and optional member-addressed recap superlatives JSON, validation and legacy fallback. | iOS game API contract | High | 2026-11-14 |
| `agent-docs/product-specs/weekly-game.md` | Weekly game product spec: Not for me profile lists, visible player/history fields, private activity tool and typed-word filtering; group invitation recovery, pair and group habit games, 24-hour own-message chat authority, Linq reaction agreement including opening-message attestation, combined asks, invites, posting and unlocking, day close, stakes, settlement and the 7-day correction window, recap, typed-word ideas, self area-code hints, held-ticket message addresses and the server contract the app renders. | Weekly game product spec | High | 2026-11-19 |
| `agent-docs/product-specs/hosted-support-escalation.md` | Hosted support product spec. | Hosted support product spec | High | 2026-08-05 |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted billing/product spec. | Hosted billing/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/health-commons.md` | Health Commons behavior. | Health Commons behavior | High | 2026-10-19 |
| `agent-docs/product-specs/murph-onboarding.md` | Three-reply Web opening, model-owned identity saves, and aspiration-anchored private onboarding. | New-member onboarding behavior | High | 2026-09-24 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment onboarding behavior. | Experiment onboarding behavior | High | 2026-10-19 |
| `agent-docs/product-specs/experiment-adherence-confidence.md` | Read-time assumed adherence, confidence ladder, correction semantics, category-scoped activity evidence, and typed subjective session evidence for experiments. | Experiment adherence behavior | High | 2026-07-16 |
| `agent-docs/product-specs/experiment-outcome-selection.md` | Experiment-only selection rules for member-valued and capturable outcomes, credible evidence, typed session metrics, timeframe integrity, and setup handoff. | Experiment outcome selection behavior | High | 2026-07-16 |
| `agent-docs/product-specs/captures.md` | Capture behavior. | Capture behavior | High | 2026-08-10 |
| `agent-docs/product-specs/ios-meals.md` | v2 iOS Meals list/detail/queued-delete contract, encrypted projection ownership, errors, phone upload linkage, reader-first rollout, native thumbnail lookup, private saved numbers and About you height through canonical measurements, and existing contact/profile/Apple Health endpoints. | iOS Meals API contract | High | 2026-11-16 |
| `agent-docs/product-specs/companion-app.md` | Companion app plan. | Companion app plan | High | 2026-08-13 |
| `agent-docs/product-specs/query-metric-universality.md` | Universal metric queryability invariant: every metric-bearing canonical event yields a query metric point through the generic extraction rule. | Query metric product spec | High | 2026-07-22 |
| `agent-docs/product-specs/companion-app-mvp.md` | Companion app build and authentication recovery telemetry contract. | Companion app build plan | High | 2026-09-05 |
| `agent-docs/product-specs/ios-address-book-advisory-names.md` | Companion/group privacy contract. | Companion/group privacy contract | High | 2026-08-28 |
| `agent-docs/product-specs/habitat.md` | Canonical Habitat context, browser projection removal and saved-state Environment retirement. | Habitat product spec | High | 2026-10-19 |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step with member-chosen contact-card avatar, independent from `/home` first-visit personalization. | Contact-card picker spec | Medium | 2026-07-22 |
| `agent-docs/product-specs/murph-personas.md` | Classic assistant defaults, retained style preferences and retired-persona compatibility. | Assistant style behavior | High | 2026-10-19 |
| `agent-docs/product-specs/murph-tone-and-voice.md` | Murph speaking-style preferences, Eleven v4 expressive cues, and conversational voice language memory. | Murph speaking-style preference spec | Medium | 2026-09-29 |
| `agent-docs/product-specs/shared-message-targeting.md` | Shared opaque accepted-message reference, authority resolver, native-reply marker, reaction reuse, provider behavior, and immediate runner rollout contract. | Assistant messaging behavior | High | 2026-07-16 |
| `agent-docs/product-specs/group-chat-social-dynamics.md` | Group conversation behavior, unanswered-request reconsideration, and requested graph presentation. | Group conversation behavior | High | 2026-09-17 |
| `agent-docs/product-specs/group-managed-automations.md` | Implemented member/group managed-owner isolation, execution checks, and retirement behavior. | Managed group automation behavior | High | 2026-11-16 |
| `agent-docs/product-specs/group-health-newsletter.md` | Group newsletter behavior. | Group newsletter behavior | Medium | 2026-08-22 |
| `agent-docs/product-specs/group-challenge-formats-and-scorecards.md` | Individual, team, and collective challenge formats plus one-to-five model-interpreted additive components with deterministic point arithmetic and aggregation. | Group challenge scorecards | High | 2026-07-29 |
| `agent-docs/product-specs/group-challenge-data-diagnostics.md` | Group diagnostics, plain metric permissions with 90-date retention (180 for the four pair-board metrics), source coverage, and consumer-first rollout limits. | Group challenge diagnostics | High | 2026-11-18 |
| `agent-docs/product-specs/challenge-standings-card.md` | Group challenge standings response card. | Group challenge standings response card | High | 2026-08-11 |
| `agent-docs/product-specs/personal-group-awareness.md` | Personal Murph read access to hosted-group memberships. | Hosted group self-awareness | High | 2026-08-29 |
| `agent-docs/product-specs/private-group-consultation.md` | Hosted group consultation. | Hosted group consultation | High | 2026-08-28 |
| `agent-docs/product-specs/consented-group-disclosure.md` | Hosted group disclosure. | Hosted group disclosure | High | 2026-08-26 |
| `agent-docs/product-specs/hosted-group-join-confirmation.md` | Hosted group membership behavior. | Hosted group membership behavior | High | 2026-07-23 |
| `agent-docs/product-specs/clinical-records-intake.md` | Bounded clinical import, stable undated-fact replay, optional daily checks, document enrichment, saved results and privacy controls. | Clinical Records intake behavior | High | 2026-09-15 |
| `agent-docs/references/companion-presence.md` | Companion contact observations, client header/build diagnostics, member lookup SQL, and consented group timestamps. | Companion presence | High | 2026-11-15 |
| `agent-docs/references/epic-automatic-distribution.md` | Epic automatic-distribution API matrix, hospital-approved imports, optional persistent credentials and privacy questionnaire guidance. | Epic import registration and rollout | High | 2026-09-15 |
| `agent-docs/phone-calls/retell-phone-agent.md` | Retell hosted phone agent prompt, authority, transfer, and call-brief handling rules. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/phone-calls/retell-analysis-fields.md` | Retell post-call analysis field contract and transcript-retention boundary. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/feature-user-story-audit/README.md` | Feature user-story audit overview and artifact inventory. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/gap-triage.md` | Triage notes for gaps found during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/parse-warnings.md` | Parser warnings captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/testing-errors.md` | Test errors captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/references/game-selfplay-qa.md` | Synthetic game state map, native self-play rounds, canonical chat edits, confirmed fixes and remaining coverage gaps. | Game QA evidence | Medium | 2026-11-09 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/codebase-simplicity-audit-2026-11-11.md` | Architecture findings, completed deletions, retained behavioral proof, deferred work and release tracking. | Codebase simplicity audit | Medium | 2026-11-11 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/app-state-machines.md` | 88 cross-repository state families, invariants, transitions, confirmed failure schedules, retired Web dashboard lifecycles, group recovery retry ownership, the unified native reminder lifecycle, clinical receipt-derived outcomes, regression proof and release evidence. | Shared Murph/iOS audit | Medium | 2026-11-07 |
| `agent-docs/references/recap-show-contract.md` | Final-at-acceptance pair recap presentation, continuous score and lyric clocks, late-singer song retakes, authenticated media slots, the optional video in parts and synthetic native decoder fixtures. | Native recap contract | High | 2026-11-15 |
| `agent-docs/references/testing-ci-map.md` | Which tests and CI jobs prove which behavior: package and app lanes, smoke flows, PR CI and what a diff reaches, protected-main proof and coverage owners. | Testing and CI truth | High | 2026-11-18 |
| `packages/core/bench/README.md` | Secret-free Docker import and hydration reproduction, required one-vCPU latency CI budgets, and sizing evidence limits. | Container CPU benchmark | Medium | 2026-09-04 |
| `packages/core/bench/container-sizing.md` | Synthetic Docker CPU/RAM sizing matrix, foreground profiling, and limits of production downsizing evidence. | Container sizing investigation | Medium | 2026-09-09 |
| `packages/query/bench/README.md` | Reproduce synthetic query resource measurements through public canonical and query APIs in constrained Docker containers. | Query resource benchmarks | Medium | 2026-09-09 |
| `packages/vault-usecases/bench/wearable-sources.md` | Measured public-usecase source-health benchmark: reusable wearable projection, fixed workloads, strict saved-result replay, repeat cohorts, retained global-position flags and synthetic timing limits. | Source-health performance | Medium | 2026-09-13 |
| `packages/vault-usecases/bench/README.md` | Synthetic experiment-progress timing through the composed usecase, semantic parity, and baseline comparison limits. | Experiment progress performance | Medium | 2026-09-11 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-postgres-runtime.md` | Postgres-only admission, owner/resource authority, completion-race diagnostics, deployment skew and workflow-gated runtime schema cleanup. | Hosted runtime ownership | High | 2026-11-16 |
| `agent-docs/references/hosted-runtime-protocol.md` | Hosted execution protocol: runner lifecycle, checkpoints and restore, mailbox admission, wakes, delivery, expected vault-share deferral telemetry, device-sync drain budgets and their recovery rules. | Hosted execution architecture and bounded device-sync drain budgets | High | 2026-11-19 |
| `agent-docs/references/hosted-temporal-orchestration.md` | Hosted Temporal orchestration, usage-blocked readiness and restoration wakes, compatible controller-first bootstrap, checkpointed device-continuation rechecks, digest-bound production-core release admission, and explicit Web admission status delivery. | Hosted Temporal orchestration target | High | 2026-09-11 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Paused giant-file cleanup planning guidance and current worth-planning/keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-09-10 |
| `agent-docs/research/2026-08-23-vault-cli-error-recovery-audit.md` | Point-in-time exhaustive Vault CLI audit of generic, lossy, untyped, misleading-success, and privacy-unsafe error paths, with prioritized model-recovery work packages. | CLI error-recovery audit | Medium | 2026-08-24 |
| `agent-docs/research/2026-08-13-alternating-routine-set-resolution.md` | Privacy-safe production correlation and root-cause analysis for repeated strength-set completions attributed to the wrong exercise in an alternating routine. | Investigation artifact | Medium | 2026-08-13 |
| `agent-docs/research/2026-08-05-ios-android-companion-parity-audit.md` | Mobile companion parity audit. | Mobile companion parity audit | Medium | 2026-08-05 |
| `agent-docs/research/2026-07-16-codex-session-architecture-audit.md` | Point-in-time aggregate evidence from the frozen 30-day Codex session audit. | Architecture audit research artifact | Medium | 2026-07-18 |
| `agent-docs/research/2026-07-10-junction-labs-commerce-and-fulfillment.md` | Point-in-time Junction lab-ordering research and phased product, commerce, fulfillment, result-import, and launch-gate proposal. | Research and future planning artifact | Medium | 2026-07-10 |
| `agent-docs/research/2026-09-11-junction-historical-sweep-efficiency.md` | Official Junction webhook/history contracts, daily safety-sweep rationale, targeted refreshes, and validation gaps. | Research and future planning artifact | Medium | 2026-09-11 |
| `agent-docs/research/2026-06-25-imessage-line-flag-evidence.md` | Point-in-time redacted evidence note for the 2026-06-25 iMessage line flag investigation. | Investigation artifact | Medium | 2026-06-26 |
| `agent-docs/operations/agent-workflow-routing.md` | Task scope, authority, member-outreach confirmation, checkout, commits, and instruction ownership. | Agent workflow routing | High | 2026-11-14 |
| `agent-docs/operations/product-ux.md` | Product UX workflow. | Product UX workflow | High | 2026-08-31 |
| `agent-docs/operations/live-provider-canaries.md` | Fresh native, Linq, Stripe and Garmin provider outcomes; bounded Linq observation retries, GitHub dispatch, protected execution, exact receipts and cross-repository rollout. UTC weekly cadence (nine Linq, five per native platform, two Garmin/Stripe) and unchanged manual/release proof. | Live provider proof | High | 2026-10-20 |
| `agent-docs/operations/github-app-kms.md` | GitHub OIDC, KMS App signing, token renewal and post-job revocation. | CI GitHub App credential owner | High | 2026-11-16 |
| `agent-docs/operations/native-android-hosted-e2e.md` | Native Android verification operations. | Native Android verification operations | High | 2026-09-01 |
| `agent-docs/operations/verification-and-runtime.md` | Which checks to run for a change, where they run, the PR and direct-push paths, and what each verification command means. | Verification policy | High | 2026-11-14 |
| `agent-docs/operations/database-transaction-starvation-audit.md` | Database critical-section reliability. | Database critical-section reliability | High | 2026-08-09 |
| `agent-docs/operations/typescript-verification-performance.md` | tsrs check/build routing, declaration consumer proof, TypeScript fallback, host compatibility, worker budgets, incremental CI caches, watch and paired compiler benchmarks. | Verification performance policy | Medium | 2026-10-20 |
| `agent-docs/operations/completion-workflow.md` | How a task finishes: evidence, candidate review, PR description, changelog decision, final ReviewGPT eligibility and handoff. | Completion workflow | High | 2026-11-14 |
| `agent-docs/operations/imessage-deliverability.md` | Phone-number messaging policy, iMessage-only inactivity and canonical requested-Ask exemptions, and direct duplicate handoff identity. | Phone-number messaging policy | High | 2026-11-18 |
| `agent-docs/operations/local-storage-lifecycle.md` | Local rebuildable-storage lifecycle, guarded retirement, and dependency hook setup. | Local rebuildable-storage lifecycle | High | 2026-09-11 |
| `agent-docs/operations/hosted-local-worktree-dev.md` | Local hosted runtime workflow, required canonical HTTPS proxy dependencies and occupied-listener admission, call-scoped cancellation, and exact-child startup/exit cleanup ownership. | Local hosted runtime workflow | Medium | 2026-09-28 |
| `agent-docs/operations/pr-reviewgpt-loop.md` | How to run a required final ReviewGPT round: launch, waiting, capture recovery, finding disposition and merge readiness. | Final PR ReviewGPT loop | Medium | 2026-11-14 |
| `agent-docs/operations/device-sync-ingestion-invariants.md` | Device-sync push/pull ingestion, daily recovery, checkpoint-owned continuation preflight, bounded deferral of future history, pending-start history scans, bounded completion-marker retention, operation-local source admission reuse, and the one-time summary and weight re-read a coverage generation bump runs for settled history. Bounded complete-hour recovery for oversized hourly-feature resource jobs. Sleep session ownership of window-keyed stage records. | Device-sync ingestion contract | High | 2026-11-16 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules; a plan archived in an open PR stays correctable until merge. | Plan workflow | Medium | 2026-11-12 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/active/` | Task-owned in-flight execution plans. | Active plan lifecycle | Medium | 2026-08-20 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke seam prompts governed by a shared review-only, evidence, correction, and zero-finding contract. | Seam-audit prompt library | Low | 2026-07-13 |
| `apps/web/README.md` | Hosted Web setup, runtime ownership, build/deploy contracts, and bounded legacy phone-call deletion execution. | `apps/web/**` | Medium | 2026-11-02 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview, runtime contract, container-free local Worker startup profiling, pinned native Codex build/update ownership, search-first `cf` API operations, pinned open-beta setup, existing Wrangler workflow exceptions, retired member shell-hint transport, and custom connection relay/manifest compatibility and Codex-home protection. | `apps/cloudflare/**` | Medium | 2026-11-16 |
| `apps/cloudflare/scripts/benchmark-workspace-restore.md` | Synthetic encrypted restore benchmark, measurement controls, and local/Linux limitations. | Cloudflare workspace restore | Medium | 2026-09-04 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution, consumer-first Web runtime admission, single-pool capacity, isolated artifact smoke, compatible native gradual rollout, and member shell-hint transport retirement. | Hosted deploy flow | Medium | 2026-09-10 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime, current-conversation Linq claiming calls, durable completion, Browser Vault wake qualification, compiled-worker prerequisites for focused entrypoint tests, and the lazy custom connection port. | `packages/assistant-runtime/**` | Medium | 2026-11-15 |
| `packages/device-syncd/README.md` | Hosted wearable ingestion and finite reconciliation boundary. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/clinical-records/README.md` | Pure Clinical Records Intake contracts for raw FHIR retrieval manifests, deterministic source references, import-plan decisions, and bounded document-extraction proposals. | `packages/clinical-records/**` | Medium | 2026-09-11 |
| `packages/health-metrics/README.md` | Neutral metric contracts, wearable catalogs, sample summaries, reviewed lab ranges, normalization, display formatting, and selection policy. | `packages/health-metrics/**` | Medium | 2026-09-10 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam; browser-vault owns replica contracts without legacy dashboard wrappers. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/query/README.md` | Query projection ownership, strict source-health snapshot capture, provider-projected parity and no-publication fast paths. | `packages/query/**` | Medium | 2026-09-13 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, generated-delivery ref ownership, hosted state rules, and hosted Codex rollout snapshot scope without ChatGPT auth portability or retired assistant status projection. | `packages/runtime-state/**` | Medium | 2026-07-16 |
| `packages/vault-usecases/README.md` | CLI/headless vault usecase orchestration boundary over core, importers, and query. | `packages/vault-usecases/**` | Medium | 2026-05-02 |
| `packages/gateway-core/README.md` | Transport-neutral reply-route inference and shared route vocabulary. | Gateway API boundary | Medium | 2026-11-02 |
| `packages/operator-config/README.md` | Operator configuration reads, hosted writes, provider normalization and channel contracts. | Operator configuration boundary | Medium | 2026-11-02 |
| `agent-docs/prompts/seam-audits/17-inbox-services.md` | Current initialization, read, promotion and storage-repair audit scope. | Inbox services audit | Medium | 2026-11-02 |
| `agent-docs/prompts/seam-audits/19-gateway-core.md` | Current reply-route inference and vocabulary audit scope. | Gateway audit | Medium | 2026-11-02 |

## Conventions

- One row per document, with a one-sentence purpose. What a doc says belongs in
  that doc.
- Add, remove or move a row when a doc is added, removed, moved or repurposed.
  `pnpm docs:gardening` fails on an unindexed doc or a row whose target is gone.
- `pnpm docs:drift` requires this file to change whenever another agent doc
  changes. Update that doc's row: its `Last verified` date, and its purpose if
  that changed. Change notes belong in the PR and the plan, so add no prose
  here.
- Research and audits are evidence for their date, not operating policy.

Repository complexity reduction and caller-proven helper retirement are tracked in
[the simplification plan](exec-plans/completed/2026-11-14-simplify-complexity.md).
