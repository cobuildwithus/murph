# Healthy Bob Agent Docs Index

Last verified: 2026-03-17 (assistant binding/delivery and Ink-only chat docs, assistant automation cursor docs, inbox model-routing trust boundaries, local web observability docs including launcher-owned runtime-build closure checks, preserved launch-cwd semantics, webpack query-entry pinning, local device-sync control-plane docs for CLI and web auth plus localhost-default bind and per-account job-serialization runtime assumptions, setup alias/wrapper semantics, smoke coverage docs, and CLI verification guardrails are aligned across process docs)

## Purpose

This index is the table of contents for durable, repository-local context that agents should use.

## Canonical Docs

| Path | Purpose | Source of truth | Owner | Review cadence | Criticality | Last verified |
| --- | --- | --- | --- | --- | --- | --- |
| `README.md` | Repo bootstrap summary, runtime-package status, and verification entrypoint for humans. | Repository bootstrap decisions | Healthy Bob Maintainer | Per bootstrap/process change | Medium | 2026-03-17 |
| `ARCHITECTURE.md` | Top-level module map and trust-boundary summary. | Product/runtime code plus repo decisions | Healthy Bob Maintainer | Per architecture change | High | 2026-03-17 |
| `docs/architecture.md` | One-page architecture summary and target repo shape for the baseline vault plus adjunct device-sync, inbox, parser, and web layers. | Baseline vault architecture decisions | Healthy Bob Maintainer | Per architecture change | High | 2026-03-17 |
| `docs/contracts/` | Frozen contract docs for vault layout, schemas, command surface, and invariants. | Baseline vault interface decisions | Healthy Bob Maintainer | Per contract change | High | 2026-03-17 |
| `agent-docs/PLANS.md` | Execution-plan workflow and storage conventions. | `agent-docs/exec-plans/**` | Healthy Bob Maintainer | Per process change | Medium | 2026-03-12 |
| `agent-docs/PRODUCT_SENSE.md` | Product-behavior guardrails for future implementation work. | Product specs + user-facing behavior | Healthy Bob Maintainer | Monthly | Medium | 2026-03-12 |
| `agent-docs/QUALITY_SCORE.md` | Current quality posture by area. | Docs, checks, audits, test posture | Healthy Bob Maintainer | Bi-weekly | Medium | 2026-03-12 |
| `agent-docs/RELIABILITY.md` | Reliability guardrails and failure-mode expectations. | Runtime behavior + recovery strategy | Healthy Bob Maintainer | Per reliability-affecting change | High | 2026-03-12 |
| `agent-docs/SECURITY.md` | Security constraints, trust boundaries, and escalation rules. | Auth/secrets/data boundaries/process | Healthy Bob Maintainer | Per security-affecting change | High | 2026-03-16 |
| `agent-docs/product-specs/index.md` | Index for product-spec documents. | `agent-docs/product-specs/**` | Healthy Bob Maintainer | Per behavior change | High | 2026-03-12 |
| `agent-docs/product-specs/repo-bootstrap.md` | Current repository state and bootstrap success criteria. | Repository bootstrap decisions | Healthy Bob Maintainer | Until first product feature lands | High | 2026-03-12 |
| `agent-docs/references/README.md` | Reference-pack overview and maintenance rules. | `agent-docs/references/**` | Healthy Bob Maintainer | Monthly | Medium | 2026-03-12 |
| `agent-docs/references/repo-scope.md` | Repo scope, ownership boundary, and unknowns. | Workspace routing + local decisions | Healthy Bob Maintainer | Per scope change | High | 2026-03-12 |
| `packages/device-syncd/README.md` | Package-local overview for the local wearable OAuth/webhook/reconcile daemon and its control-plane env contract. | `packages/device-syncd/**` | Healthy Bob Maintainer | Per device-sync runtime change | Medium | 2026-03-17 |
| `packages/web/README.md` | Package-local overview for the local-only Next.js observability app and its vault configuration contract. | `packages/web/**` | Healthy Bob Maintainer | Per web-surface change | Medium | 2026-03-17 |
| `packages/parsers/README.md` | Package-local overview for local-first attachment parsing, provider ranking, and derived artifact publication. | `packages/parsers/**` | Healthy Bob Maintainer | Per parser-layer change | Medium | 2026-03-13 |
| `agent-docs/references/testing-ci-map.md` | Current verification map for contracts/runtime packages, built CLI checks, the smoke harness, device-sync/web package coverage including Oura config/provider tests, the targeted Vitest/V8 package coverage surface, and the source-artifact guard. | `package.json`, `scripts/**`, `fixtures/**`, `e2e/**`, future CI | Healthy Bob Maintainer | Per verification change | High | 2026-03-17 |
| `agent-docs/operations/verification-and-runtime.md` | Required checks, runtime-package verification matrix, built CLI behavior coverage, device-sync/web control-plane assumptions including localhost-default `device-syncd` host and per-account job serialization plus Oura daemon verification coverage, assistant binding/delivery runtime assumptions, setup alias/wrapper semantics, package-local no-emit typecheck semantics, and current runtime assumptions for the TypeScript-first workspace. | `AGENTS.md`, `package.json`, `fixtures/**`, `e2e/**`, `scripts/**` | Healthy Bob Maintainer | Per process/runtime change | High | 2026-03-17 |
| `agent-docs/operations/completion-workflow.md` | Required post-implementation audit workflow. | Prompts + completion process | Healthy Bob Maintainer | Per process change | High | 2026-03-13 |
| `agent-docs/prompts/simplify.md` | Reusable simplification pass prompt with parallel-agent handoff output. | Completion workflow | Healthy Bob Maintainer | Per process change | Medium | 2026-03-13 |
| `agent-docs/prompts/test-coverage-audit.md` | Reusable coverage-audit prompt with parallel-agent handoff output. | Completion workflow | Healthy Bob Maintainer | Per process change | High | 2026-03-13 |
| `agent-docs/prompts/task-finish-review.md` | Reusable final completion audit prompt with parallel-agent handoff output. | Completion workflow | Healthy Bob Maintainer | Per process change | High | 2026-03-13 |
| `agent-docs/generated/README.md` | Generated doc artifacts produced by scripts. | `agent-docs/generated/**` | Healthy Bob Maintainer | Per script change | Medium | 2026-03-12 |
| `agent-docs/exec-plans/active/` | Active execution plans and in-flight coordination docs. | Plan workflow | Healthy Bob Maintainer | Per process change | Medium | 2026-03-13 |
| `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | Active task coordination ledger for safe concurrent work; rows are notices by default and exclusive only when explicitly marked. | Active coding sessions | Healthy Bob Maintainer | Continuous | High | 2026-03-13 |
| `agent-docs/exec-plans/completed/` | Immutable completed execution-plan snapshots. | Plan workflow | Healthy Bob Maintainer | Per process change | Medium | 2026-03-12 |
| `agent-docs/exec-plans/tech-debt-tracker.md` | Rolling debt register with owner/priority/status. | Audits, reviews, bootstrap follow-ups | Healthy Bob Maintainer | Bi-weekly | Medium | 2026-03-12 |

## Conventions

- Keep `AGENTS.md` short and route-oriented.
- Update this index whenever docs are added, removed, or moved.
- Treat `UNCONFIRMED` product/domain assumptions as temporary and replace them with concrete specs before broad implementation work.
- For multi-file or high-risk work, add a plan in `agent-docs/exec-plans/active/`.
- Keep `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` current during active coding work, and mark rows as exclusive only when overlap is genuinely unsafe.
- For `packages/cli` work, treat `ARCHITECTURE.md` and `agent-docs/operations/verification-and-runtime.md` as the durable home for incur-specific routing, typegen, and built-vs-source verification rules.
