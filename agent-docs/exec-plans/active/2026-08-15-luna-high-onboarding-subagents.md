# Use Luna high workers for hosted onboarding delegation

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Prepare hosted onboarding to delegate bounded health-history persistence to
  `gpt-5.6-luna` workers at high reasoning without activating the route before
  exact model and token accounting is authoritative for every child request.

## Success criteria

- The existing onboarding foundation persistence assignments select Luna/high
  only when authoritative child-request model, tier, and attempt evidence is
  available; otherwise the production switch fails closed.
- The existing onboarding foundation-memo contract continues to delegate each
  supplied independent save family to one-shot workers without speculative
  routing or recovery promises.
- Assistant-engine remains the sole usage-ledger writer and does not synthesize
  Luna usage from the parent model or non-authoritative V2 metadata.
- Non-OpenAI and local/development paths retain working accounting and routing.
- Murph's ReviewGPT dependency resolves the latest published package and its
  package-backed runner contract remains covered.
- Focused tests, affected package typechecks, exact-head CI, and required
  ReviewGPT gates pass.

## Scope

- In scope: hosted OpenAI Codex config, authoritative child-request accounting
  boundaries where Murph owns them, the requested ReviewGPT dependency bump,
  and focused regression coverage.
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
   Mitigation: expose no child-routing controls until the runtime and ledger
   evidence path are upgraded together; every current provider inherits root
   routing.
4. Risk: a preparatory prompt invents idempotency, fallback, or recovery
   capabilities that canonical health owners do not provide.
   Mitigation: leave the active onboarding contract unchanged and keep future
   routing policy in typed runtime ownership rather than model-readable prose.

## Tasks

1. [x] Give ReviewGPT the implementation packet and obtain its proposed patch.
2. [x] Inspect and integrate the smallest safe implementation against current
   runtime-config, engine-accounting, and onboarding owners.
3. [x] Add focused fail-closed runtime and non-authoritative-evidence
   regressions without changing the active onboarding persistence contract.
4. [x] Run focused tests and affected package typechecks, then inspect the diff for
   privacy and scope.
5. [x] Finish the initial candidate, push it, open a draft PR, and start the
   preliminary specialist and final ReviewGPT passes concurrently with CI.
6. [ ] Resolve accepted findings on a new exact head and complete the gates.

## Decisions

- Do not move ordinary hosted OpenAI accounting to Worker egress. Egress sees
  provider facts but not Murph's immutable turn, attempt, request-ordinal, and
  child-assignment identity, so it must not become a second ledger authority.
- Keep assistant-engine as the sole ledger writer. Do not infer a Luna child's
  model or tier from the parent when authoritative V2 evidence is missing.
- Keep arbitrary per-spawn overrides hidden. A future Luna/high rollout must be
  selected by a typed runtime capability after its authoritative evidence path
  and representative evaluations land; the active skill must not authorize
  billing-critical routing through a natural-language marker.
- Do not enable the Luna/high production route on Codex 0.147.0. Its canonical
  V2 activity item proves child lifecycle and thread identity but not the
  effective child model, reasoning effort, service tier, provider attempt, or
  terminal usage. The generated hosted config now hides per-spawn routing
  metadata explicitly and tells every current hosted child to inherit the root
  route.
- Accept the preliminary specialist findings that the first ReviewGPT patch
  invented a family-level recovery key, contradicted mixed-dispatch fallback,
  and put routing authority in prompt prose. Remove that entire active-skill
  addition rather than adding new health-record or transport machinery.
- Upgrade the repository-backed ReviewGPT runner from 0.5.127 to the registry's
  current 0.5.131 release and update its release-contract assertions.
- Pin `ORACLE_DRAFT_MINIMUM_MARKED_RESPONSE_MS=300000` at Murph's package-runner
  boundary. ReviewGPT 0.5.131 intentionally makes that value configurable for
  direct callers, but Murph's completion gate must not inherit an ambient value
  that can weaken the repository's five-minute marked-response trust floor.

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
  passed after the trust-floor remediation: 46 tests, 1 skipped. The new child
  process regression starts with an ambient value of `1` and observes `300000`
  at the package boundary; the in-memory package harness uses that same
  repository-owned value, while the existing boundary cases prove `299999`
  is rejected and `300000` is admitted.
- An isolated pinned Codex 0.147.0 config parse accepted
  `features.multi_agent_v2.hide_spawn_agent_metadata = true` and reported
  multi-agent V2 enabled.
- `npm view @cobuild/review-gpt version --json` and
  `pnpm exec cobuild-review-gpt --version` both reported 0.5.131.
- `git diff --check` passed after applying the separately authored ReviewGPT
  patch; the candidate diff and patch were scanned for direct identifiers.
- After specialist remediation removed the speculative active-skill contract,
  the focused onboarding skill-assets suite again passed with 25 tests and 6
  skips, assistant-engine typecheck passed, and `git diff --check` stayed clean.
- Exact-head CI passed on the first-reviewed commit. The preliminary specialist
  pass returned substantive findings after 34 minutes; its accepted prompt
  findings were removed on a remediation head. A 41-minute final pass confirmed
  those findings resolved and found the ambient trust-floor override introduced
  by ReviewGPT 0.5.131; the repository-boundary pin and regression above resolve
  it. A fresh final pass and exact-head CI remain pending. Two pre-send browser
  failures and one rejected nine-second response were not treated as reviews;
  no Eragon lane was used.
