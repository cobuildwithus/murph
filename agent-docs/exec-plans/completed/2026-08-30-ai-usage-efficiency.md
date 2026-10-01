# AI usage efficiency

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make customer-assigned AI usage reflect the model actually served and stop
  paying repeatedly for identical attachment text, without changing model
  quality, reasoning, tools, or answer content.

## Success criteria

- Venice regular Luna usage is priced at the current regular Luna rates rather
  than Luna Pro rates.
- A deterministic canonical-pricer scenario proves the same allowance funds at
  least 20% more regular Luna work.
- Exact duplicate normalized source bodies within one attachment are emitted
  once, while the first provenance, structured summaries, and every distinct
  source body remain available.
- A focused real-Codex attachment journey remains useful, correct, and free of
  unavailable-attachment claims.
- Focused tests, affected package typechecks, exact-head review, and required CI
  pass.

## Scope

- In scope: Venice GPT-5.6 Luna allowance pricing, exact per-attachment evidence
  deduplication, focused regression and live-assistant proof, and an honest
  member-facing changelog entry.
- Out of scope: model downgrades or routing, fuzzy or cross-attachment dedupe,
  total attachment truncation, ambient project-document policy, provider retry
  policy, usage-callback reliability, new caches, and new usage infrastructure.

## Constraints

- Technical constraints: preserve the existing allowance pricer as the sole
  pricing owner; preserve the first duplicate fragment's label and path; add no
  dependency, state owner, queue, or pricing service.
- Product/process constraints: do not claim a fleet-wide 20% saving when the
  proven gains apply to the corrected provider/model scenario and duplicated
  attachment-evidence slice; keep all verification fixtures synthetic.

## Risks and mitigations

1. Risk: a price update could accidentally change Sol or Terra accounting.
   Mitigation: keep model-specific cases in the focused provider pricing table
   and assert every rate and total.
2. Risk: deduplication could hide genuinely different evidence.
   Mitigation: dedupe only exact normalized text inside one attachment, retain
   first provenance, and prove distinct fragments remain.
3. Risk: lower prompt bytes could make the assistant mishandle a voice memo.
   Mitigation: compose the production prompt, assert the duplicate appears once,
   and run the focused real-Codex voice-memo journey.

## Tasks

1. Completed: audited accounting, routing, prompt/context, retries, tool loops,
   background inference, multimodal, caching, and measurement seams in parallel.
2. Completed: corrected Venice regular Luna rates and added focused
   canonical-pricer proof.
3. Completed: deduplicated exact per-attachment source bodies and strengthened
   deterministic production-bundle coverage, including clamp and summary
   collision cases.
4. Completed: ran focused unit tests, typechecks, the live attachment journey,
   and measured before/after benchmarks.
5. Completed: prepared the scoped candidate for the standard commit, draft PR,
   changelog provenance, exact-head specialist/final review, and required CI
   workflow that follows plan archival.

## Decisions

- Keep model selection and reasoning unchanged; unit-price correction and exact
  duplicate removal are the only quality-neutral savings proven above 20%.
- Reject a total attachment budget in this PR because distinct evidence would
  need an omission policy. The 32 MiB constant is a read budget, not current
  provider-visible prompt size; projected fragments are already capped.
- Leave project-document policy and usage-callback replay to separate changes:
  the former changes global prompt behavior, while the latter improves
  accounting completeness rather than customer cost efficiency.

## Product UX

- Effort: Patch.
- Affected people: a member who selects Luna through Venice, and a member who
  sends an audio/video attachment whose parser exposes the same transcript in
  more than one representation.
- Expected experience: allowance declines at the rate of the model actually
  served, and Murph answers from the same attachment facts without spending
  context on repeated copies.
- Recovery and boundaries: unknown pricing still fails closed through the
  existing pricer; distinct evidence and separate attachments are unchanged.

## Product UX walkthrough

- Venice Luna: select regular Luna with Venice, complete a turn, and observe
  regular-Luna allowance pricing with no model or reply change.
- Duplicate attachment evidence: receive a synthetic voice memo with the same
  transcript projected inline and through both parser text representations,
  compose one provider-visible copy, and answer the requested fact without
  asking for a resend.
- Result: Ready. The deterministic production-bundle test retained the first
  transcript and distinct table evidence while reducing three identical
  6,000-character bodies from 18,000 to 6,000 characters. The focused real-Codex
  journey answered `Amber lighthouse`, made one provider request, reported no
  missing usage, and made no resend or unavailable-attachment claim.

## Verification

- `pnpm test -- hosted-execution-usage-allowance.test.ts` in `apps/web`: 119
  passed. A frozen 1M uncached-input plus 1M output reference workload prices at
  1,870,000 USD micros instead of 8,750,000, so the same allowance funds 4.679x
  that exact workload.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage
  test/inbox-evidence-projection.test.ts
  test/assistant-attachment-evidence-model.test.ts` in `packages/assistant-engine`:
  26 passed. Exact 18,000-to-6,000 character reduction, first provenance,
  distinct tails, structured summaries, and distinct evidence all passed.
- `pnpm typecheck` in `packages/assistant-engine` and `apps/web`: both passed.
- `pnpm test:assistant:live -- --codex-home <AUTHENTICATED_HOME> --test
  "answers from the admitted voice memo transcript without claiming the memo is
  unavailable"`: 1 passed, 174 skipped; one provider request, complete usage,
  and a Ready answer. One earlier authenticated attempt was manually stopped
  after remaining silent beyond its expected wall time; the final isolated run
  passed on the production-realistic derived-result fixture.
Completed: 2026-08-30
