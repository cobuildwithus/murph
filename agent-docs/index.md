# Murph Agent Docs Index

Last verified: 2026-06-18

## Purpose

This index is the table of contents for the current canonical docs in this repository.
It intentionally lists live architecture, product, verification, and package-boundary docs only.

## Canonical Docs

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, public package posture, local/hosted runtime tiers, and verification entrypoints. | Current repository state | High | 2026-05-02 |
| `ARCHITECTURE.md` | Top-level module map, trust boundaries, persisted-state rules, hosted mailbox/checkpoint ownership, hosted generated-image ownership, hosted Temporal hard-cut pointer, bounded device-sync mailbox handoff ownership, active-turn targeting lifecycle, control-flow contracts, and package-boundary rules. | Current runtime architecture | High | 2026-06-09 |
| `PRODUCT.md` | Strategic design context: register, users, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system in Google Stitch DESIGN.md format: color, typography, elevation, components, do's/don'ts, YAML token frontmatter. Loaded by the impeccable skill before any UI work. | Visual design system | High | 2026-04-24 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, package-boundary hygiene notes, and hosted ownership baseline. | Current architectural baseline | High | 2026-05-13 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and invariants. | Canonical vault interface decisions | High | 2026-04-26 |
| `docs/device-sync-hosted-control-plane.md` | Current hosted control-plane direction for device sync. | Device-sync architecture direction | Medium | 2026-05-13 |
| `docs/device-provider-contribution-kit.md` | Maintainer guide for adding wearable providers. | Provider contribution workflow | Medium | 2026-05-13 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations. | Device-provider normalization planning | Medium | 2026-05-13 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam and future rotation constraints. | Hosted contact-privacy rotation seam | Medium | 2026-05-13 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account data export and deletion workflow, store coverage, security checks, and retention limits. | Hosted account privacy workflow | High | 2026-05-13 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-05-13 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-04-29 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/PRODUCT_SENSE.md` | Product behavior guardrails for implementation work. | Current product behavior | High | 2026-05-13 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules. | Product principles | High | 2026-04-22 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`, including design-system sources (`PRODUCT.md`, `DESIGN.md`) and UI workflow rules. | Current frontend implementation guidance | Medium | 2026-04-24 |
| `agent-docs/product-marketing-context.md` | Product marketing context: positioning, audience, differentiation, customer language, brand voice, and the protocol outcome graph. Rewritten 2026-06-10 around the group-challenge wedge with fact/hypothesis/target-state labels. | Product/marketing decisions | High | 2026-06-10 |
| `agent-docs/user-interviews.md` | User-interview kit: cardinal rules, prospective-user and existing-user scripts, question swaps, signal lists, Murph-specific probes, after-call synthesis template. Based on Gustaf Alströmer's YC talk + PG. | User research method | Medium | 2026-06-10 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails and failure-mode expectations. | Runtime reliability policy | High | 2026-06-09 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, and escalation rules, including Cloudflare immediate-deploy Blacksmith secret access and Worker-owned hosted generated-image uploads. | Security policy | High | 2026-06-09 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-05-13 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/pulse-trial-checkout-offer.md` | Implemented Pulse Trial checkout-offer architecture over existing hosted billing and hosted AI usage allowance primitives. | Hosted billing/product spec | High | 2026-05-05 |
| `agent-docs/product-specs/pulse-trial-start-paid-pulse.md` | Implemented exhausted Pulse Trial conversion to paid Pulse by ending the Stripe trial and billing the existing Pulse subscription. | Hosted billing/product spec | High | 2026-05-13 |
| `agent-docs/product-specs/hosted-plan-downgrades.md` | Stripe Subscription Schedule plan for Edge-to-Pulse switches at renewal, with hosted billing read-model and settings UX expectations. | Hosted billing/product spec | High | 2026-05-06 |
| `agent-docs/product-specs/health-commons.md` | Health Commons product boundary for wiki-like pages, build-time catalog generation, scoped runtime artifacts, future aggregate outcome summaries, revisions, and artifact manifests. | Health Commons behavior | High | 2026-06-05 |
| `agent-docs/product-specs/protocol-summary-copy.md` | Source-of-truth copy rules for Health Commons protocol `summary:` fields shown on `/experiments` cards. | Health Commons protocol card copy | High | 2026-04-30 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment onboarding product boundary for start intents, Health Commons setup slots, assistant safety/setup flow, reminder-support policy, and private run handoff. | Experiment onboarding behavior | High | 2026-06-07 |
| `agent-docs/product-specs/protocol-outcome-network.md` | Protocol outcome network boundary for private outcome cards now and future sharing, contribution, cohort summaries, and social guardrails. | Outcome network behavior | High | 2026-05-13 |
| `agent-docs/product-specs/captures.md` | Capture primitive product boundary for dated private media evidence. | Capture behavior | High | 2026-04-21 |
| `agent-docs/product-specs/companion-app.md` | Native Swift iOS companion app for Apple Health sync, hybrid WHOOP posture, MVP scope, and phases. | Companion app plan | High | 2026-06-10 |
| `agent-docs/product-specs/query-metric-universality.md` | Universal metric queryability invariant: every metric-bearing canonical event yields a query metric point through the generic extraction rule. | Query metric product spec | High | 2026-06-12 |
| `agent-docs/product-specs/companion-app-mvp.md` | Two-screen companion app MVP build spec: Privy login, Connect Apple Health, sign-in token endpoint. | Companion app build plan | High | 2026-06-10 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/testing-ci-map.md` | Verification map for packages, apps, smoke flows, CI, diff-aware package-boundary checks, hosted Temporal orchestration guard coverage, hosted web E2E testkit triggers, the hosted-local Workers AI transcription E2E gate, and the Cloudflare immediate-deploy Blacksmith path. | Testing and CI truth | High | 2026-06-10 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-runtime-protocol.md` | Hosted mailbox/workspace checkpoint protocol, signed email reply-alias ingress boundary, host-deadline-free runtime-kind write-fence authority, wake-unconfirmed retry semantics, stale runtime fence recovery, idle-shutdown-only checkpoint snapshot writing, package-owned hosted invocation bridge/snapshot planning/diagnostics with Cloudflare decode/direct-R2/archive capabilities, session-referenced Codex rollout snapshotting without a separate manifest, restore-time Codex resume sanitization, committed transcript fallback for fresh Codex starts, legacy snapshot restore compatibility, Worker-owned mailbox payload decode boundary, hosted-local provider-fetch and direct-R2 host-alias routing rules, web/Cloudflare deploy compatibility plus hard-cut Durable Object retired-table migration, mailbox import with best-effort inbox projection plus audio/video transcript enrichment, active-turn live steering and strict targeting semantics, foreground runtime wakes, scanner-owned assistant input replay progress through `eligibleAfter` plus terminal evidence, Temporal-owned due-reconcile device-sync scheduled wakes cadence, bounded `device-sync.wake` dirty-state handoffs, retry-only mailbox scheduling without dirty checkpoints, Workflow-owned pointer nudge retry ownership, and deleted run-protocol guardrails. | Hosted execution architecture | High | 2026-06-08 |
| `agent-docs/references/hosted-temporal-orchestration.md` | Durable hard-cut Temporal orchestration ADR defining final ownership split, pointer-only Temporal state, signal-aware retry/wait behavior including failed-runtime completion backoff, web signal-client and worker Temporal Cloud auth/TLS parity, callback-signed execution-adapter and device-sync scheduled wake sweep contract, web-owned reconciliation facts without Activity-local signed usage decisions, mailbox-lag priority, global device-sync scheduled-wake Schedule ownership with bounded mailbox handoff, Cloudflare scheduler deletion targets, Vercel Workflow nudge deletion targets, architecture guard coverage, and acceptance criteria; `agent-docs/exec-plans/completed/TEMPORAL.md` is the completed execution snapshot. | Hosted Temporal orchestration target | High | 2026-06-08 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Paused giant-file cleanup planning guidance and current worth-planning/keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-06-03 |
| `agent-docs/research/murph-age-autoresearch.md` | Murph Age autoresearch operating rules, including the ReviewGPT-vs-Codex role split, transition gates, and source/privacy boundaries. | Murph Age research workflow | High | 2026-05-09 |
| `agent-docs/operations/agent-workflow-routing.md` | Workflow router for task classes, plans, audits, verification, commit paths, default worktree/PR isolation, and paused giant-file policy status. | Agent workflow routing | High | 2026-06-09 |
| `agent-docs/operations/verification-and-runtime.md` | Verification rules, build command semantics, hosted Temporal guard coverage, DBHub timestamp-read guardrails, runtime assumptions, and doc-gardening scope for repo work. | Verification policy | High | 2026-06-18 |
| `agent-docs/operations/completion-workflow.md` | Required post-implementation audit and completion flow. | Completion workflow | High | 2026-06-18 |
| `agent-docs/operations/pr-deep-review-loop.md` | Required post-completion GPT-5.5 Pro external PR deep-review loop: fire `pnpm review:gpt pr-review` per round on a fresh thread in parallel with PR CI, verify each finding before landing it, stop at zero accepted findings or 5 rounds. | PR deep-review loop | Medium | 2026-06-18 |
| `agent-docs/operations/device-sync-ingestion-invariants.md` | The five device-sync push/pull ingestion invariants (pull floor, push-early/pull-eventually, degrade-to-fetch-never-silence, idempotent merge, louder-never-quieter) that any webhook/resource-job/reconcile change must preserve. | Device-sync ingestion contract | High | 2026-06-10 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules. | Plan workflow | Medium | 2026-03-31 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/active/` | In-flight execution plans for current work. | Active work coordination | Medium | 2026-05-05 |
| `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | Active-work ledger for concurrent repo tasks. | Concurrency coordination | High | 2026-05-05 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/` | Reusable review and audit prompt templates for the completion workflow, including the prompt-primary `prompt-review` pass. | Workflow prompt library | Low | 2026-06-07 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke audit prompts for the major repo seams used in broad risk and simplification review sweeps. | Seam-audit prompt library | Low | 2026-04-23 |
| `apps/web/README.md` | Hosted web control-plane overview, env/runtime contract, hosted AI usage allowance ownership, Temporal reconciliation-facts boundary, and app-source/testkit ownership split. | `apps/web/**` | Medium | 2026-06-03 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview and runtime contract, including Worker-owned hosted generated-image upload config. | `apps/cloudflare/**` | Medium | 2026-06-09 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution, including immediate Blacksmith deploy handoff validation, hosted generated-image upload config, and no signed usage-allowance start secret. | Hosted deploy flow | Medium | 2026-06-09 |
| `packages/assistantd/README.md` | Local assistant daemon boundary and control-plane contract. | `packages/assistantd/**` | Medium | 2026-03-30 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime surface consumed by Cloudflare. | `packages/assistant-runtime/**` | Medium | 2026-04-30 |
| `packages/device-syncd/README.md` | Local wearable sync runtime boundary and env contract. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/health-metrics/README.md` | Neutral MetricPoint contracts, health metric definitions, unit normalization, display formatting, and selection policy. | `packages/health-metrics/**` | Medium | 2026-05-02 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/hosted-orchestrator-temporal/README.md` | Private Temporal worker package, local dev harness, device-sync reconciler Schedule helper, Render worker deployment notes, env contract, and smoke path for hosted runtime orchestration. | `packages/hosted-orchestrator-temporal/**` | Medium | 2026-05-22 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, hosted state rules, and hosted Codex rollout snapshot scope. | `packages/runtime-state/**` | Medium | 2026-06-04 |
| `packages/vault-usecases/README.md` | CLI/headless vault usecase orchestration boundary over core, importers, and query. | `packages/vault-usecases/**` | Medium | 2026-05-02 |

## Conventions

- Keep this index focused on live docs that describe the current repo state.
- Do not list point-in-time architecture reviews, migration guides, or historical cleanup audits here.
- Keep current external compatibility references such as the device-provider compatibility matrix when they describe active planning or provider requirements.
- Update this index whenever canonical docs are added, removed, moved, or materially repurposed.
