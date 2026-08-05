# Use Luna Fast for first-contact admission

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Reduce the model-gated portion of fresh-number text signup latency by routing
  the existing first-contact classifier through GPT-5.6 Luna in Fast mode with
  medium reasoning effort.
- Preserve the current bounded input, strict structured output, fail-closed
  behavior, persisted model-source authority, and all downstream onboarding
  invariants.

## Success criteria

- The default classifier model is `gpt-5.6-luna` while the existing explicit
  environment override remains supported.
- Every classifier Responses API request uses `reasoning.effort: "medium"`,
  `service_tier: "priority"`, `store: false`, and the unchanged strict decision
  schema. OpenAI documents `priority` as the compatibility alias for Fast mode,
  and it remains the literal supported by the repository's pinned SDK types.
- Focused tests prove the exact request shape, default/override behavior, and
  existing classifier outcomes and failure handling.
- Focused local verification, exact-head CI, the preliminary coverage review,
  and the final trust-boundary ReviewGPT gate pass with no unresolved finding.

## Scope

- In scope: the Web-owned Linq first-contact admission model default, its
  Responses API request shape, focused tests, and any directly matching live
  security/operations documentation required for accuracy.
- Out of scope: changing member-selected assistant models, changing the
  classifier prompt or decision policy, altering admission budgets or fallback
  behavior, changing billing/access authority, or optimizing the remaining
  signup/runtime path.

## Constraints

- Keep unknown-contact content within the existing approved OpenAI egress
  boundary and never add message text or raw provider output to logs or durable
  artifacts.
- Preserve model-source admission authority, strict schema parsing, timeout and
  refusal behavior, replay safety, and explicit environment overrides.
- Add no router, fallback model, state owner, dependency, or abstraction for a
  single request-shape change.

## Risks and mitigations

1. Risk: a model-role change alters allow/block quality.
   Mitigation: retain the exact prompt/schema and require focused behavioral
   tests; treat live quality/latency comparison as a post-deploy measurement.
2. Risk: Fast mode is requested incorrectly or silently omitted.
   Mitigation: use the official Responses API `service_tier: "priority"`
   compatibility alias and assert it in the request-body regression.
3. Risk: a production environment override keeps Terra active.
   Mitigation: inspect secret-safe deployment configuration names/status and
   report or correct the effective configuration through the owning surface.

## Tasks

1. [x] Inventory the classifier request, environment default/override, tests,
   SDK types, and effective deployment configuration.
2. [x] Add regressions for Luna, medium reasoning, and Fast mode.
3. [x] Implement the smallest request/default change and update directly owned
   documentation if required.
4. [x] Run focused tests, Web typecheck, direct diff/privacy checks, and parent
   review.
5. [ ] Commit and push the exact candidate, open the PR, and complete required
   ReviewGPT and CI gates.
6. [ ] Resolve findings, close this plan through `scripts/finish-task`, prove a
   conflict-free final head, and hand off or merge/retire as the workflow allows.

## Verification log

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-env.test.ts`
  passed: 2 files and 48 tests.
- `pnpm --dir apps/web typecheck` passed.
- A direct production-function request capture with a stubbed provider response
  proved Luna, medium reasoning, the `priority` Fast-mode alias, `store: false`,
  the strict schema, and a parsed model-source allow decision together.
- `git diff --check` passed.
- A names-and-scopes-only Vercel inspection found an explicit classifier-model
  override in development, preview, and production. Those entries must move to
  Luna with the exact candidate rollout; no values were downloaded or printed.
