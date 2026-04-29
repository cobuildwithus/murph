# Murph Agent Docs Index

Last verified: 2026-04-29

## Purpose

This index is the table of contents for the current canonical docs in this repository.
It intentionally lists live architecture, product, verification, and package-boundary docs only.

## Canonical Docs

| Path | Purpose | Source of truth | Criticality | Last verified |
| --- | --- | --- | --- | --- |
| `README.md` | Human-facing repo overview, install path, runtime tiers, and verification entrypoints. | Current repository state | High | 2026-04-22 |
| `ARCHITECTURE.md` | Top-level module map, trust boundaries, persisted-state rules, control-flow contracts, and package-boundary rules. | Current runtime architecture | High | 2026-04-29 |
| `PRODUCT.md` | Strategic design context: register, users, brand personality, anti-references, design principles. Loaded by the impeccable skill before any UI work. | Product/brand strategic context | High | 2026-04-24 |
| `DESIGN.md` | Visual design system in Google Stitch DESIGN.md format: color, typography, elevation, components, do's/don'ts, YAML token frontmatter. Loaded by the impeccable skill before any UI work. | Visual design system | High | 2026-04-24 |
| `docs/architecture.md` | Concise architecture summary, repo-shape overview, and package-boundary hygiene notes. | Current architectural baseline | High | 2026-04-22 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, commands, and invariants. | Canonical vault interface decisions | High | 2026-04-26 |
| `docs/device-sync-hosted-control-plane.md` | Current hosted control-plane direction for device sync. | Device-sync architecture direction | Medium | 2026-04-19 |
| `docs/device-provider-contribution-kit.md` | Maintainer guide for adding wearable providers. | Provider contribution workflow | Medium | 2026-04-03 |
| `docs/device-provider-compatibility-matrix.md` | Canonical provider planning matrix and evidence expectations. | Device-provider normalization planning | Medium | 2026-04-03 |
| `docs/hosted-contact-privacy-rotation.md` | Hosted blind-index keyring seam and future rotation constraints. | Hosted contact-privacy rotation seam | Medium | 2026-04-09 |
| `docs/hosted-account-data-deletion-export.md` | Hosted account data export and deletion workflow, store coverage, security checks, and retention limits. | Hosted account privacy workflow | High | 2026-04-29 |
| `docs/legal-consent-implementation.md` | Hosted legal consent document registry, event/grant storage, API routes, and gate helpers. | Hosted legal consent workflow | High | 2026-04-29 |
| `docs/health-data-incident-runbook.md` | Engineering runbook for suspected health-data incidents, consent bypasses, vendor incidents, and tracking disclosures. | Health-data incident response | High | 2026-04-29 |
| `docs/templates/README.md` | Entry points for reusable device-provider templates. | Template inventory | Low | 2026-04-03 |
| `agent-docs/PRODUCT_SENSE.md` | Product behavior guardrails for implementation work. | Current product behavior | High | 2026-04-22 |
| `agent-docs/PRODUCT_CONSTITUTION.md` | Internal product constitution and tradeoff rules. | Product principles | High | 2026-04-22 |
| `agent-docs/FRONTEND.md` | Frontend implementation guidance for `apps/web`, including design-system sources (`PRODUCT.md`, `DESIGN.md`) and UI workflow rules. | Current frontend implementation guidance | Medium | 2026-04-24 |
| `agent-docs/product-marketing-context.md` | Product marketing context: positioning, audience, differentiation, customer language, brand voice, and the protocol outcome graph. | Product/marketing decisions | High | 2026-04-22 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Current repo quality posture | Medium | 2026-04-06 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails and failure-mode expectations. | Runtime reliability policy | High | 2026-03-31 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, and escalation rules. | Security policy | High | 2026-04-29 |
| `agent-docs/compliance/README.md` | Compliance reference-pack overview, launch minimums, and official source links for consumer health-data obligations. | Compliance docs index | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-incident-plan.md` | Internal incident playbook for suspected FTC HBNR breaches, unauthorized disclosures, vendor incidents, and tracking disclosures involving health data. | Health-data incident response | High | 2026-04-29 |
| `agent-docs/compliance/ftc-hbnr-notice-templates.md` | Counsel-reviewed template starting points for consumer, FTC, media, vendor, and internal incident notices. | Health-data notice workflow | High | 2026-04-29 |
| `agent-docs/compliance/vendor-health-data-addendum.md` | Vendor clause library and procurement checklist for providers that process identifiable health data or health-context metadata. | Vendor health-data contracting | High | 2026-04-29 |
| `agent-docs/compliance/health-data-tracking-and-ads-rule.md` | Hard rule and review checklist for analytics, telemetry, ad pixels, attribution, and marketing tools on health-data surfaces. | Health-data tracking policy | High | 2026-04-29 |
| `agent-docs/product-specs/index.md` | Index for product-spec docs. | Product-spec inventory | High | 2026-04-22 |
| `agent-docs/product-specs/repo.md` | Canonical repository posture and success criteria. | Current repo product spec | High | 2026-04-06 |
| `agent-docs/product-specs/health-commons.md` | Health Commons product boundary for wiki-like pages, generated catalogs, aggregate outcome summaries, revisions, and artifact manifests. | Health Commons behavior | High | 2026-04-22 |
| `agent-docs/product-specs/experiment-onboarding.md` | Experiment onboarding product boundary for start intents, Health Commons setup slots, assistant safety/setup flow, and private run handoff. | Experiment onboarding behavior | High | 2026-04-26 |
| `agent-docs/product-specs/protocol-outcome-network.md` | Protocol outcome network boundary for outcome cards, sharing, contribution, cohort summaries, and social guardrails. | Outcome network behavior | High | 2026-04-26 |
| `agent-docs/product-specs/captures.md` | Capture primitive product boundary for dated private media evidence. | Capture behavior | High | 2026-04-21 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | Reference pack conventions | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Concrete repo scope and routing boundaries. | Repo ownership boundary | High | 2026-04-06 |
| `agent-docs/references/testing-ci-map.md` | Verification map for packages, apps, smoke flows, and CI. | Testing and CI truth | High | 2026-04-27 |
| `agent-docs/references/health-entity-taxonomy-seam.md` | Shared owner seam for health taxonomy metadata. | Health taxonomy seam | Medium | 2026-04-06 |
| `agent-docs/references/hosted-runtime-protocol.md` | Hosted mailbox/workspace checkpoint protocol and deleted run-protocol guardrails. | Hosted execution architecture | High | 2026-04-29 |
| `agent-docs/references/data-model-seams.md` | Current shared-owner notes for high-leverage data-model seams. | Data-model seam guidance | Medium | 2026-04-07 |
| `agent-docs/references/giant-file-composability-seams.md` | Current split-now, worth-planning, and keep-together notes for oversized multi-responsibility files. | Giant-file composability seam guidance | Medium | 2026-04-14 |
| `agent-docs/operations/agent-workflow-routing.md` | Workflow router for task classes, plans, audits, verification, and commit paths. | Agent workflow routing | High | 2026-04-09 |
| `agent-docs/operations/verification-and-runtime.md` | Verification rules and runtime assumptions for repo work. | Verification policy | High | 2026-04-27 |
| `agent-docs/operations/completion-workflow.md` | Required post-implementation audit and completion flow. | Completion workflow | High | 2026-04-09 |
| `agent-docs/PLANS.md` | Execution-plan lifecycle and storage rules. | Plan workflow | Medium | 2026-03-31 |
| `agent-docs/generated/README.md` | Meaning and expectations for generated doc artifacts. | Generated-doc conventions | Low | 2026-04-02 |
| `agent-docs/exec-plans/active/` | In-flight execution plans for current work. | Active work coordination | Medium | 2026-04-02 |
| `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | Active-work ledger for concurrent repo tasks. | Concurrency coordination | High | 2026-04-06 |
| `agent-docs/exec-plans/completed/` | Historical execution-plan snapshots kept as process records rather than live architecture docs. | Completed plan archive | Low | 2026-03-28 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Current debt register with owner/priority/status. | Rolling debt tracker | Medium | 2026-03-12 |
| `agent-docs/prompts/` | Reusable review and audit prompt templates for the completion workflow. | Workflow prompt library | Low | 2026-04-23 |
| `agent-docs/prompts/seam-audits/` | One-pass bespoke audit prompts for the major repo seams used in broad risk and simplification review sweeps. | Seam-audit prompt library | Low | 2026-04-23 |
| `apps/web/README.md` | Hosted web control-plane overview and env/runtime contract. | `apps/web/**` | Medium | 2026-04-02 |
| `apps/cloudflare/README.md` | Hosted execution-plane overview and runtime contract. | `apps/cloudflare/**` | Medium | 2026-04-29 |
| `apps/cloudflare/DEPLOY.md` | Current deployment procedure for hosted execution. | Hosted deploy flow | Medium | 2026-04-29 |
| `packages/assistantd/README.md` | Local assistant daemon boundary and control-plane contract. | `packages/assistantd/**` | Medium | 2026-03-30 |
| `packages/assistant-runtime/README.md` | Headless hosted runtime surface consumed by Cloudflare. | `packages/assistant-runtime/**` | Medium | 2026-03-27 |
| `packages/device-syncd/README.md` | Local wearable sync runtime boundary and env contract. | `packages/device-syncd/**` | Medium | 2026-04-02 |
| `packages/gateway-local/README.md` | Local gateway runtime and projection-store ownership boundary. | `packages/gateway-local/**` | Medium | 2026-04-06 |
| `packages/hosted-execution/README.md` | Shared hosted execution contracts, auth, env, and client seam. | `packages/hosted-execution/**` | Medium | 2026-03-28 |
| `packages/messaging-ingress/README.md` | Shared stateless messaging ingress boundary. | `packages/messaging-ingress/**` | Medium | 2026-04-02 |
| `packages/runtime-state/README.md` | `.runtime` taxonomy, portability, and local/hosted state rules. | `packages/runtime-state/**` | Medium | 2026-04-01 |

## Conventions

- Keep this index focused on live docs that describe the current repo state.
- Do not list point-in-time architecture reviews, migration guides, or historical cleanup audits here.
- Keep current external compatibility references such as the device-provider compatibility matrix when they describe active planning or provider requirements.
- Update this index whenever canonical docs are added, removed, moved, or materially repurposed.
