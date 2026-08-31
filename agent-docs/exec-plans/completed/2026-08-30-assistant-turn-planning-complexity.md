# Refactor assistant turn planning complexity

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce `resolveAssistantRouteTurnPlan` cyclomatic complexity through cohesive,
  behavior-preserving planner helpers while leaving every assistant route,
  authority decision, provider input, retry/error path, silence decision, and
  user-visible reply contract unchanged.

## Success criteria

- The target planner's measured cyclomatic complexity drops materially from the
  baseline of 226 without moving policy ownership or adding dependencies.
- Focused deterministic planner tests, assistant-engine typecheck, and the
  behavior-verification journey required by the assistant contract pass.
- Provider-input impact is explicitly proven unchanged or any unavoidable
  impact is identified and reviewed.
- The scoped diff passes privacy inspection, is committed through the repository
  helper, pushed, and represented by an open draft PR.

## Scope

- In scope: `resolveAssistantRouteTurnPlan`, direct planner-owned helpers, and
  focused direct tests needed to protect the refactor.
- Out of scope: route-policy changes, new state machines or generic abstractions,
  dependencies, public prompt/schema changes, and unrelated cleanup.

## Constraints

- Technical constraints: preserve return values, ordering, tool/skill
  eligibility, group/private authority, retries/errors, telemetry, and composed
  provider inputs exactly; use named helpers with explicit inputs.
- Product/process constraints: ReviewGPT's implementation patch is untrusted
  input and only accepted minimal intent may be applied with `apply_patch`;
  follow Frog, assistant verification, scoped verification, and draft-PR rules.

## Risks and mitigations

1. Risk: extraction subtly changes branch ordering or eager/lazy provider-input
   construction.
   Mitigation: map every branch before extraction, keep calls in the same
   orchestration order, add deterministic boundary assertions, and inspect the
   exact diff against the original.
2. Risk: complexity moves into opaque or duplicated policy helpers.
   Mitigation: extract cohesive decisions only, keep one policy owner, measure
   both the entry point and introduced helpers, and reject generic machinery.

## Tasks

1. [x] Read repository contracts, inventory planner branches/tests, and capture
   the original provider-input and assistant-behavior contracts.
2. [x] Keep implementation local under the coordinating instruction not to run
   formal ReviewGPT or specialist lanes during this refactor.
3. [x] Apply the smallest accepted decomposition with focused deterministic
   tests.
4. [x] Run focused tests, typecheck, provider-input proof, and before/after
   complexity measurement. After the preliminary prompt specialist identified
   the repository-required live-model proof gap, extend and run one focused
   production-derived direct-route journey.
5. [x] Inspect the final diff/privacy, rebase the unpublished branch onto the
   current `origin/main`, rerun the focused proof, push, and open a draft PR.

## Decisions

- Keep this a mechanical decomposition unless direct proof reveals an existing
  behavior dependency that makes extraction unsafe.
- Preserve the original orchestration and side-effect call order in the entry
  point; helpers only receive explicit inputs and return values previously
  calculated inline.
- Measure every introduced helper as well as the target. The exact target moved
  from cyclomatic complexity 226 to 40, and the largest introduced helper is
  24.
- Treat the deterministic full-plan characterization as the provider-input
  proof. It covers direct, authenticated group, maintenance, output-only, and
  scheduled-email routes. Supplement it with one focused real-Codex direct
  route journey that asserts exactly one provider request, one committed
  user/assistant transcript pair, and the scenario-specific truthful reply.
- Leave the PR in draft. Formal review and broad CI remain separate from this
  implementation pass.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-turn-planning.test.ts`
  from `packages/assistant-engine`: passed, 102 tests.
- `node scripts/run-typescript.mjs package -p packages/assistant-engine/tsconfig.typecheck.json --pretty false`:
  passed.
- `node /tmp/murph-cyclomatic.mjs packages/assistant-engine/src/assistant/codex-turn/planning.ts`:
  target 40 versus baseline 226; largest introduced helper 24.
- Deterministic provider-input/route-plan characterization: passed for five
  representative branch families and all stable returned fields.
- `pnpm test:assistant:live -- --test "answers once from an early detail retained across sixty committed messages"`:
  passed, 1 test on `gpt-5.6-terra` through the local subscription. The direct
  route made one provider request, committed one user/assistant pair, and
  replied `The cobalt folder.` without internal or tool language. Manual reply
  review verdict: Ready.
- `git diff --check origin/main...HEAD`: passed after the rebase.
- `pnpm test:diff packages/assistant-engine/src/assistant/codex-turn/planning.ts packages/assistant-engine/test/assistant-codex-turn-planning.test.ts`:
  guards and affected package typechecks passed, then the command waited for an
  unrelated exclusive shared-host test slot. The coordinating instruction was
  to stop the owned verifier and let broad CI own that lane, so the command is
  truthfully recorded as incomplete with exit 130 rather than passed.

## Review finding disposition

- Accepted the preliminary prompt specialist's medium finding that this
  prompt/tool-routing refactor needed the repository-required focused
  real-Codex acceptance journey in addition to deterministic proof.
- Remediation extends the existing production-path direct conversation
  reconstruction journey rather than adding another harness or changing
  production behavior. It now proves one provider request, one reply effect,
  exact transcript cardinality, scenario truth, and forbidden internal/tool
  wording; the focused live run passed and the reply was judged Ready.
Completed: 2026-08-30
