# Murph Agent Docs Index

Last verified: 2026-09-05

## Purpose

Device-sync metadata priority within the existing bounded envelope is specified
by `agent-docs/RELIABILITY.md`; Junction's progress keys remain provider-owned.

This is a directory, not a second copy of the system contracts. Start with
`AGENTS.md` and `agent-docs/operations/agent-workflow-routing.md`; open the
owners relevant to the task. A row's date is its recorded verification date,
not a guarantee that every claim was checked in this cleanup.

## Canonical Docs

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, public package posture, local/hosted runtime tiers, and verification entrypoints. | Current repository state | High | 2026-05-02 |
| `ARCHITECTURE.md` | Current runtime architecture. | Current runtime architecture | High | 2026-08-31 |
| `agent-docs/ARCHITECTURE_GUIDANCE.md` | Architecture planning guidance. | Architecture planning guidance | High | 2026-08-24 |
| `PRODUCT.md` | Strategic design context: register, users, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system. | Visual design system | High | 2026-07-22 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, package-boundary hygiene notes, and hosted ownership baseline. | Current architectural baseline | High | 2026-05-13 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and cross-cutting invariants. | Canonical vault interface decisions | High | 2026-07-20 |
| `docs/contracts/06-hosted-workspace-file-count.md` | Hosted workspace checkpoint/restore contract. | Hosted workspace checkpoint/restore contract | High | 2026-08-04 |
| `docs/device-sync-hosted-control-plane.md` | Current hosted control-plane direction for device sync. | Device-sync architecture direction | Medium | 2026-08-13 |
| `docs/device-provider-contribution-kit.md` | Maintainer guide for adding wearable providers. | Provider contribution workflow | Medium | 2026-05-13 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations. | Device-provider normalization planning | Medium | 2026-07-14 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam and future rotation constraints. | Hosted contact-privacy rotation seam | Medium | 2026-07-16 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account data export and deletion workflow, store coverage, security checks, and retention limits. | Hosted account privacy workflow | High | 2026-05-13 |
| `docs/hosted-runtime-log-database.md` | Dedicated hosted runtime-log Postgres ownership, deletion fence, retention, web-control preflight rejection attribution, migration preflight, and rollback floor. | Hosted runtime observability storage | High | 2026-09-02 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-05-13 |
| `docs/incident-response.md` | Canonical incident.io-backed runbook for declaring, coordinating, communicating, resolving, and learning from Murph production incidents. | Incident coordination and public status policy | High | 2026-08-05 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-08-05 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/strategy.md` | Current product strategy. | Current product strategy | High | 2026-07-15 |
| `agent-docs/PRODUCT_SENSE.md` | Current product posture for a broad personal health assistant. | Current product behavior | High | 2026-08-13 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules. | Product principles | High | 2026-07-15 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`. | Current frontend implementation guidance | Medium | 2026-08-31 |
| `agent-docs/product-marketing-context.md` | Product/marketing decisions. | Product/marketing decisions | High | 2026-07-15 |
| `agent-docs/user-interviews.md` | User research method. | User research method | Medium | 2026-07-12 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails, failure modes, and accepted-mailbox progress evidence. | Runtime reliability policy | High | 2026-09-04 |
| `agent-docs/operations/stripe-effect-compatibility-cutover.md` | Hosted billing operations. | Hosted billing operations | High | 2026-08-28 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, hosted media receipt recovery and atomic retirement, and escalation rules. | Security policy | High | 2026-09-05 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/2026-07-23-connected-source-launch-gate.md` | Connected-source permission assumption, launch status, and ongoing provider controls. | Connected-source release gate | High | 2026-07-23 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-07-16 |
| `agent-docs/product-specs/imessage-workout-tracking.md` | iMessage workout product spec. | iMessage workout product spec | High | 2026-09-03 |
| `agent-docs/product-specs/bring-your-own-inference.md` | Personal custom inference contract covering verified member-owned endpoints, explicit selection, no silent fallback, privacy, metering, and recovery. | Hosted assistant/custom inference product spec | High | 2026-07-31 |
| `agent-docs/product-specs/member-owned-device-provider-applications.md` | Member-owned OAuth client application contract for provider-portal provisioning, exact app revision binding, polling-first runtime config, and optional signed webhooks. | Device-provider connection product spec | High | 2026-08-09 |
| `agent-docs/product-specs/measured-biomarker-index.md` | Curated measured-biomarker navigation over preserved private lab history. | Biomarkers product spec | High | 2026-07-20 |
| `agent-docs/product-specs/journal.md` | Private timeline derived from canonical health records. | Journal product spec | High | 2026-08-24 |
| `agent-docs/product-specs/personal-patterns.md` | Deterministic private context-to-outcome findings. | Personal Patterns product spec | High | 2026-08-24 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/starter-usage.md` | Non-expiring $4.50 starter usage on the immutable usage-credit ledger. | Hosted access/billing product spec | High | 2026-08-18 |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Edge-to-Pulse renewal switches plus the web-owned hosted assistant configuration and personalization resolvers. | Hosted billing/current-state spec | High | 2026-07-30 |
| `agent-docs/product-specs/hosted-plan-usage.md` | Hosted billing/current-state spec. | Hosted billing/current-state spec | High | 2026-08-18 |
| `agent-docs/product-specs/hosted-group-member-plan.md` | Private $3.50 Core subscription for confirmed hosted-group members. | Hosted billing/product spec | High | 2026-08-25 |
| `agent-docs/product-specs/labs-discovery.md` | Hosted Labs product spec. | Hosted Labs product spec | High | 2026-07-16 |
| `agent-docs/product-specs/hosted-usage-topups.md` | Hosted billing/product spec. | Hosted billing/product spec | High | 2026-08-26 |
| `agent-docs/product-specs/hosted-usage-referrals.md` | Hosted growth/product spec. | Hosted growth/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/physical-notes.md` | Hosted physical-note product spec. | Hosted physical-note product spec | High | 2026-08-21 |
| `agent-docs/product-specs/hosted-support-escalation.md` | Hosted support product spec. | Hosted support product spec | High | 2026-08-05 |
| `agent-docs/product-specs/hosted-family-plan.md` | Hosted billing/product spec. | Hosted billing/product spec | High | 2026-08-10 |
| `agent-docs/product-specs/health-commons.md` | Health Commons behavior. | Health Commons behavior | High | 2026-07-29 |
| `agent-docs/product-specs/public-goal-guides.md` | Goal guide behavior. | Goal guide behavior | High | 2026-08-30 |
| `agent-docs/product-specs/murph-safe-public-product-search.md` | Public product evidence behavior. | Public product evidence behavior | High | 2026-09-02 |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Health Commons protocol card copy | High | 2026-04-30 |
| `agent-docs/product-specs/murph-onboarding.md` | Aspiration-anchored new-member onboarding contract for a private broad-assistant relationship. | New-member onboarding behavior | High | 2026-08-26 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment onboarding behavior. | Experiment onboarding behavior | High | 2026-07-30 |
| `agent-docs/product-specs/experiment-adherence-confidence.md` | Read-time assumed adherence, confidence ladder, correction semantics, category-scoped activity evidence, and typed subjective session evidence for experiments. | Experiment adherence behavior | High | 2026-07-16 |
| `agent-docs/product-specs/experiment-outcome-selection.md` | Experiment-only selection rules for member-valued and capturable outcomes, credible evidence, typed session metrics, timeframe integrity, and setup handoff. | Experiment outcome selection behavior | High | 2026-07-16 |
| `agent-docs/product-specs/protocol-outcome-network.md` | Protocol outcome network boundary for private outcome cards now and future sharing, contribution, cohort summaries, and social guardrails. | Outcome network behavior | High | 2026-05-13 |
| `agent-docs/product-specs/captures.md` | Capture behavior. | Capture behavior | High | 2026-08-10 |
| `agent-docs/product-specs/companion-app.md` | Companion app plan. | Companion app plan | High | 2026-08-13 |
| `agent-docs/product-specs/query-metric-universality.md` | Universal metric queryability invariant: every metric-bearing canonical event yields a query metric point through the generic extraction rule. | Query metric product spec | High | 2026-07-22 |
| `agent-docs/product-specs/companion-app-mvp.md` | Companion app build plan. | Companion app build plan | High | 2026-07-14 |
| `agent-docs/product-specs/ios-address-book-advisory-names.md` | Companion/group privacy contract. | Companion/group privacy contract | High | 2026-08-28 |
| `agent-docs/product-specs/habitat.md` | Habitat product spec. | Habitat product spec | High | 2026-08-11 |
| `agent-docs/product-specs/murph-contact-card-picker.md` | Post-signup add-Murph-to-contacts step with member-chosen contact-card avatar, independent from `/home` first-visit personalization. | Contact-card picker spec | Medium | 2026-07-22 |
| `agent-docs/product-specs/murph-personas.md` | Murph persona behavior. | Murph persona behavior | High | 2026-07-22 |
| `agent-docs/product-specs/murph-tone-and-voice.md` | Murph speaking-style preference spec. | Murph speaking-style preference spec | Medium | 2026-08-10 |
| `agent-docs/product-specs/shared-message-targeting.md` | Shared opaque accepted-message reference, authority resolver, native-reply marker, reaction reuse, provider behavior, and immediate runner rollout contract. | Assistant messaging behavior | High | 2026-07-16 |
| `agent-docs/product-specs/group-chat-social-dynamics.md` | Group conversation behavior. | Group conversation behavior | High | 2026-08-21 |
| `agent-docs/product-specs/group-managed-automations.md` | Implemented member/group managed-owner isolation, execution checks, and retirement behavior. | Managed group automation behavior | High | 2026-07-26 |
| `agent-docs/product-specs/group-health-newsletter.md` | Group newsletter behavior. | Group newsletter behavior | Medium | 2026-08-22 |
| `agent-docs/product-specs/group-challenge-formats-and-scorecards.md` | Individual, team, and collective challenge formats plus one-to-five model-interpreted additive components with deterministic point arithmetic and aggregation. | Group challenge scorecards | High | 2026-07-29 |
| `agent-docs/product-specs/group-challenge-data-diagnostics.md` | Group challenge diagnostics. | Group challenge diagnostics | High | 2026-08-26 |
| `agent-docs/product-specs/challenge-standings-card.md` | Group challenge standings response card. | Group challenge standings response card | High | 2026-08-11 |
| `agent-docs/product-specs/personal-group-awareness.md` | Personal Murph read access to hosted-group memberships. | Hosted group self-awareness | High | 2026-08-29 |
| `agent-docs/product-specs/private-group-consultation.md` | Hosted group consultation. | Hosted group consultation | High | 2026-08-28 |
| `agent-docs/product-specs/consented-group-disclosure.md` | Hosted group disclosure. | Hosted group disclosure | High | 2026-08-26 |
| `agent-docs/product-specs/hosted-group-join-confirmation.md` | Hosted group membership behavior. | Hosted group membership behavior | High | 2026-07-23 |
| `agent-docs/product-specs/clinical-records-intake.md` | Clinical Records intake behavior. | Clinical Records intake behavior | High | 2026-07-21 |
| `agent-docs/phone-calls/retell-phone-agent.md` | Retell hosted phone agent prompt, authority, transfer, and call-brief handling rules. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/phone-calls/retell-analysis-fields.md` | Retell post-call analysis field contract and transcript-retention boundary. | Hosted phone-call provider setup | Medium | 2026-06-25 |
| `agent-docs/feature-user-story-audit/README.md` | Feature user-story audit overview and artifact inventory. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/gap-triage.md` | Triage notes for gaps found during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/parse-warnings.md` | Parser warnings captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/feature-user-story-audit/testing-errors.md` | Test errors captured during the feature user-story audit. | Point-in-time feature audit | Low | 2026-06-21 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/testing-ci-map.md` | Verification map for packages, apps, hosted media follow-up proof, smoke flows, exact-head PR CI, protected-main runtime proof, canonical executors, and current coverage owners. | Testing and CI truth | High | 2026-09-05 |
| `packages/core/bench/README.md` | Secret-free Docker import and hydration reproduction, required one-vCPU latency CI budgets, and sizing evidence limits. | Container CPU benchmark | Medium | 2026-09-04 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-runtime-protocol.md` | Hosted mailbox/workspace checkpoints and accepted-work monitoring boundaries. | Hosted execution architecture | High | 2026-09-04 |
| `agent-docs/references/hosted-temporal-orchestration.md` | Hosted Temporal orchestration target. | Hosted Temporal orchestration target | High | 2026-09-03 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Paused giant-file cleanup planning guidance and current worth-planning/keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-06-03 |
| `agent-docs/research/2026-08-23-vault-cli-error-recovery-audit.md` | Point-in-time exhaustive Vault CLI audit of generic, lossy, untyped, misleading-success, and privacy-unsafe error paths, with prioritized model-recovery work packages. | CLI error-recovery audit | Medium | 2026-08-24 |
| `agent-docs/research/2026-08-13-alternating-routine-set-resolution.md` | Privacy-safe production correlation and root-cause analysis for repeated strength-set completions attributed to the wrong exercise in an alternating routine. | Investigation artifact | Medium | 2026-08-13 |
| `agent-docs/research/2026-08-05-ios-android-companion-parity-audit.md` | Mobile companion parity audit. | Mobile companion parity audit | Medium | 2026-08-05 |
| `agent-docs/research/2026-07-16-codex-session-architecture-audit.md` | Point-in-time aggregate evidence from the frozen 30-day Codex session audit. | Architecture audit research artifact | Medium | 2026-07-18 |
| `agent-docs/research/2026-07-10-junction-labs-commerce-and-fulfillment.md` | Point-in-time Junction lab-ordering research and phased product, commerce, fulfillment, result-import, and launch-gate proposal. | Research and future planning artifact | Medium | 2026-07-10 |
| `agent-docs/research/2026-06-25-imessage-line-flag-evidence.md` | Point-in-time redacted evidence note for the 2026-06-25 iMessage line flag investigation. | Investigation artifact | Medium | 2026-06-26 |
| `agent-docs/research/murph-age-autoresearch.md` | Murph Age autoresearch operating rules. | Murph Age research workflow | High | 2026-05-09 |
| `agent-docs/operations/agent-workflow-routing.md` | Task scope, authority, checkout, commits, and instruction ownership. | Agent workflow routing | High | 2026-09-04 |
| `agent-docs/operations/product-ux.md` | Product UX workflow. | Product UX workflow | High | 2026-08-31 |
| `agent-docs/operations/native-android-hosted-e2e.md` | Native Android verification operations. | Native Android verification operations | High | 2026-09-01 |
| `agent-docs/operations/verification-and-runtime.md` | Verification ownership by delivery path. | Verification policy | High | 2026-09-01 |
| `agent-docs/operations/database-transaction-starvation-audit.md` | Database critical-section reliability. | Database critical-section reliability | High | 2026-08-09 |
| `agent-docs/operations/typescript-verification-performance.md` | Verification performance policy. | Verification performance policy | Medium | 2026-07-29 |
| `agent-docs/operations/completion-workflow.md` | Completion workflow. | Completion workflow | High | 2026-09-02 |
| `agent-docs/operations/imessage-deliverability.md` | Phone-number messaging policy. | Phone-number messaging policy | High | 2026-08-11 |
| `agent-docs/operations/local-storage-lifecycle.md` | Local rebuildable-storage lifecycle. | Local rebuildable-storage lifecycle | High | 2026-08-10 |
| `agent-docs/operations/hosted-local-worktree-dev.md` | Local hosted runtime workflow. | Local hosted runtime workflow | Medium | 2026-08-20 |
| `agent-docs/operations/pr-reviewgpt-loop.md` | PR review for realistic serious bugs and material Complexity Collapse, with a three-round cap. | Final PR ReviewGPT loop | Medium | 2026-09-04 |
| `agent-docs/operations/device-sync-ingestion-invariants.md` | Device-sync push/pull ingestion invariants. | Device-sync ingestion contract | High | 2026-08-20 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules. | Plan workflow | Medium | 2026-03-31 |
| `agent-docs/exec-plans/completed/README.md` | Completed-plan archive interpretation. | Completed-plan archive interpretation | Medium | 2026-07-22 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/active/` | Task-owned in-flight execution plans. | Active plan lifecycle | Medium | 2026-08-20 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/` | Optional task-specific review prompts; the completion workflow determines required gates. | Workflow prompt library | Low | 2026-08-17 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke seam prompts governed by a shared review-only, evidence, correction, and zero-finding contract. | Seam-audit prompt library | Low | 2026-07-13 |
| `apps/web/README.md` | Hosted Web setup, runtime ownership, and build/deploy contracts. | `apps/web/**` | Medium | 2026-08-09 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview and runtime contract. | `apps/cloudflare/**` | Medium | 2026-07-29 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution. | Hosted deploy flow | Medium | 2026-08-26 |
| `packages/assistantd/README.md` | Local assistant daemon boundary and control-plane contract. | `packages/assistantd/**` | Medium | 2026-03-30 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime surface consumed by Cloudflare. | `packages/assistant-runtime/**` | Medium | 2026-07-15 |
| `packages/device-syncd/README.md` | Local wearable sync runtime boundary and env contract. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/clinical-records/README.md` | Pure Clinical Records Intake contracts for raw FHIR retrieval manifests, deterministic FHIR source references, and upsert/retract/review import-plan decisions. | `packages/clinical-records/**` | Medium | 2026-07-10 |
| `packages/health-metrics/README.md` | Neutral MetricPoint contracts, health metric definitions, unit normalization, display formatting, and selection policy. | `packages/health-metrics/**` | Medium | 2026-05-02 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, generated-delivery ref ownership, hosted state rules, and hosted Codex rollout snapshot scope without ChatGPT auth portability. | `packages/runtime-state/**` | Medium | 2026-07-16 |
| `packages/vault-usecases/README.md` | CLI/headless vault usecase orchestration boundary over core, importers, and query. | `packages/vault-usecases/**` | Medium | 2026-05-02 |

## Conventions

- Keep one short discovery description per document; detailed behavior belongs
  in that document and its executable owner, not this index.
- Update entries when docs are added, removed, moved, or materially repurposed.
- Research and audits are evidence for their stated date, not operating policy.
- Completed plans are immutable historical snapshots. Use live owner docs for
  implementation, deployment, rollback, and incident response.
