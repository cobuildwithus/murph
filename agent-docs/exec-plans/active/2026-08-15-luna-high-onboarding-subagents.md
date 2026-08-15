# Use Luna high workers for hosted onboarding delegation

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Make hosted onboarding delegate bounded health-history persistence to
  `gpt-5.6-luna` workers at high reasoning, while preserving exact model and
  token accounting for every provider request.

## Success criteria

- The existing onboarding foundation persistence assignments select Luna/high
  only when authoritative child-request model, tier, and attempt evidence is
  available; otherwise the production switch fails closed.
- The onboarding foundation-memo contract explicitly and promptly delegates
  each supplied independent save family to those one-shot workers.
- Assistant-engine remains the sole usage-ledger writer and consumes
  authoritative child-request evidence without synthesizing Luna usage from
  the parent model or creating duplicate legacy child records.
- Non-OpenAI and local/development paths retain working accounting and routing.
- Murph's ReviewGPT dependency resolves the latest published package and its
  package-backed runner contract remains covered.
- Focused tests, affected package typechecks, exact-head CI, and required
  ReviewGPT gates pass.

## Scope

- In scope: hosted OpenAI Codex config, onboarding delegation instructions,
  authoritative child-request accounting evidence where Murph owns it,
  duplicate-accounting cutoff, the requested ReviewGPT dependency bump, and
  focused regression coverage.
- Out of scope: arbitrary per-spawn model selection, nested delegation,
  changing the root model, and broad migration of other providers' accounting.

## Constraints

- Technical constraints: V2 `subAgentActivity` does not expose authoritative
  effective child-model evidence; both HTTP streaming and WebSocket Responses
  transports must preserve bytes, latency, retry semantics, and provider
  response delivery; usage persistence must be idempotent and private-safe.
- Product/process constraints: health-data authorization and canonical owners
  remain unchanged; children are one-shot bounded leaves; the root replies
  without waiting and never claims a save before canonical readback.

## Risks and mitigations

1. Risk: egress and engine both record the same hosted OpenAI call.
   Mitigation: keep assistant-engine as the only ledger owner and add exact
   regression proof for root and child calls.
2. Risk: transport evidence lacks Murph's accepted-turn, attempt, request, or
   child-assignment identity.
   Mitigation: keep the Worker out of ledger writes and extend the execution
   evidence at the owner that already has those logical coordinates.
3. Risk: Luna defaults leak into unsupported providers.
   Mitigation: gate the child default to the OpenAI-backed hosted config and
   retain current behavior elsewhere.
4. Risk: prompt changes over-delegate or duplicate canonical writes.
   Mitigation: keep current family boundaries, exact-source handoffs, dedupe,
   and parent non-duplication rules; strengthen only timing and worker policy.

## Tasks

1. [x] Give ReviewGPT the implementation packet and obtain its proposed patch.
2. [x] Inspect and integrate the smallest safe implementation against current
   runtime-config, engine-accounting, and onboarding owners.
3. [x] Add focused routing, authoritative-evidence, no-duplicate, fail-closed, and
   prompt-contract regressions.
4. [x] Run focused tests and affected package typechecks, then inspect the diff for
   privacy and scope.
5. [ ] Finish the plan-bearing candidate, push it, open a draft PR, and start the
   preliminary specialist and final ReviewGPT passes concurrently with CI.
6. [ ] Resolve accepted findings on a new exact head and complete the gates.

## Decisions

- Do not move ordinary hosted OpenAI accounting to Worker egress. Egress sees
  provider facts but not Murph's immutable turn, attempt, request-ordinal, and
  child-assignment identity, so it must not become a second ledger authority.
- Keep assistant-engine as the sole ledger writer. Do not infer a Luna child's
  model or tier from the parent when authoritative V2 evidence is missing.
- Keep arbitrary per-spawn overrides hidden and scope Luna/high to the existing
  onboarding foundation persistence assignments after the evidence gate is
  satisfied.
- Do not enable the Luna/high production route on Codex 0.147.0. Its canonical
  V2 activity item proves child lifecycle and thread identity but not the
  effective child model, reasoning effort, service tier, provider attempt, or
  terminal usage. The generated hosted config now hides per-spawn routing
  metadata explicitly and the prompt requires both a visible schema and a
  host-owned authoritative-evidence marker before opting in.
- Upgrade the repository-backed ReviewGPT runner from 0.5.127 to the registry's
  current 0.5.131 release and update its release-contract assertions.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts`
  passed: 44 tests, 4 skipped.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-subagent-usage.test.ts`
  passed: 12 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-skill-assets.test.ts`
  passed: 25 tests, 6 skipped.
- `pnpm --dir packages/assistant-runtime typecheck`,
  `pnpm --dir packages/assistant-engine typecheck`, and
  `pnpm --dir packages/cli typecheck` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
  passed earlier in the candidate cycle: 45 tests, 1 skipped.
- An isolated pinned Codex 0.147.0 config parse accepted
  `features.multi_agent_v2.hide_spawn_agent_metadata = true` and reported
  multi-agent V2 enabled.
- `npm view @cobuild/review-gpt version --json` and
  `pnpm exec cobuild-review-gpt --version` both reported 0.5.131.
- `git diff --check` passed after applying the separately authored ReviewGPT
  patch; the candidate diff and patch were scanned for direct identifiers.
- Exact-head CI and the preliminary and final PR ReviewGPT gates remain
  pending until the candidate is committed, pushed, and attached to a draft PR.
