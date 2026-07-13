# Align agent workflows with GPT-5.6 prompt guidance

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Align the repository instructions that govern agents building Murph with the
  current GPT-5.6 prompting guidance, while leaving Murph runtime prompts,
  product-facing prompt behavior, and Murph-owned skills unchanged.

## Success criteria

- Agent workflow docs express outcomes, success criteria, evidence and stopping
  conditions without repeating procedural scaffolding.
- Completion-audit and ReviewGPT prompts have explicit scope, evidence,
  validation, output, and zero-finding stop contracts appropriate to their job.
- Autonomy, approval, tool-routing, progress-update, and review-resolution rules
  are stated once at their owning layer and remain consistent across references.
- Product/runtime prompt builders and Murph-owned skill files have no diff.
- Required docs/process verification and the prompt-review completion pass
  finish with no unresolved accepted findings.

## Scope

- In scope: `AGENTS.md`, `CLAUDE.md`, `agent-docs/FRONTEND.md`, agent workflow
  and completion docs under `agent-docs/operations/**`, reusable completion-audit
  prompts under `agent-docs/prompts/**`, ReviewGPT presets under
  `scripts/chatgpt-review-presets/**`, ReviewGPT preset registration, and
  directly related indexes or guards.
- Out of scope: product specs; `packages/assistant-engine/**` runtime prompts;
  phone, onboarding, messaging, automation, and other member-facing prompts;
  Murph-owned skills under packages or `.agents/skills/**`; model/API runtime
  migrations and optional GPT-5.6 feature adoption.

## Constraints

- Technical constraints: preserve named-preset loading and review invocation;
  keep the PR-only contract out of aggregate non-PR execution; prefer deletion
  and consolidation over a new prompt framework or dependency.
- Product/process constraints: preserve unrelated working-tree and ledger work;
  use the docs/process plan, prompt-review, verification, and scoped commit path.

## Risks and mitigations

1. Risk: a broad prompt search accidentally changes Murph's product behavior.
   Mitigation: maintain an explicit in-scope/out-of-scope inventory and verify
   that runtime prompt and skill paths remain unchanged.
2. Risk: applying the guide mechanically creates more duplicated policy.
   Mitigation: keep rules at one owning layer, link to them, and edit only where
   a prompt must be independently executable.
3. Risk: leaner review prompts weaken hard invariants or evidence requirements.
   Mitigation: preserve safety, privacy, authority, product-critical-flow, and
   production-path proof contracts; remove only redundant process narration.

## Tasks

1. Read the live GPT-5.6 prompt guidance and required repository workflow docs.
2. Inventory agent-only docs, audit prompts, and ReviewGPT presets; map and
   exclude every product/runtime prompt and Murph skill surface.
3. Apply the smallest coherent documentation and prompt edits. Include the
   requested PR-description change-shape breakdown and user-experience outline,
   and make existing-primitive reuse/composability a primary
   `Complexity Collapse` concern in the PR ReviewGPT prompt.
4. Run direct readback, references/guard checks, prompt-review, and the required
   docs/process verification lane.
5. Inspect the final diff for scope and identifier leakage, then finish through
   the plan-aware scoped commit helper.

## Decisions

- Treat this as prompt-primary docs/process work in the current checkout; do not
  use the PR lane or change runtime model/API configuration.
- Use the linked GPT-5.6 guide as the canonical prompt source for this task.
- Remove live Fable-specific routing because that implementation lane is no
  longer available; preserve immutable historical plan records.

## Verification

- Passed: `git diff --check`, excluded-scope and stale-Fable searches,
  `bash -n scripts/review-gpt.config.sh`, `pnpm review:gpt --list-presets`,
  `pnpm docs:drift`, and the focused ReviewGPT workflow guard (33 passed, 1
  skipped).
- The `pnpm test:diff` lane for `scripts/review-gpt.config.sh` and the related CLI
  guard passed repository guards, 308 repo-tool tests, and the affected CLI
  typecheck. Its full CLI stage passed 1,081 tests and failed one credibly
  unrelated pre-existing `vault-cli-import-surface-contract.test.ts`
  stale-contract assertion.
- Prompt-review accepted and fixed three medium workflow contradictions, then a
  fresh final rerun returned zero evidence-backed findings.
- Product/runtime prompt builders and Murph-owned skills have no diff.
Completed: 2026-07-13
