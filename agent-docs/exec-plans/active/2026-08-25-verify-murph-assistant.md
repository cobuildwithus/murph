# Make real-Codex assistant verification one command

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make subscription-backed real-Codex assistant behavior tests a focused,
  one-command local workflow.
- Require future changes to Murph's assistant behavior to add and run a live
  synthetic journey, inspect Murph's actual replies, and record a UX verdict
  alongside deterministic proof.

## Success criteria

- `pnpm test:assistant:live -- --test <pattern>` runs one selected live journey
  through the normal local Codex subscription without a hand-written wrapper.
- The existing provider-key lane remains isolated and available explicitly.
- The adaptive wearable journey prints synthetic reply evidence and still
  proves exact tool effects and forbidden actions.
- A validated repo-local skill and durable workflow docs make the live journey
  and reply review mandatory for assistant-behavior changes.
- Focused tests, Assistant Engine typecheck, the subscription-backed journey,
  required ReviewGPT review, and exact-head CI pass.

## Scope

- In scope: the opt-in real-Codex test harness, a focused local runner and its
  tests, the adaptive wearable live scenario's review output, repo-local skill
  metadata, and the completion/verification/testing workflow docs.
- Out of scope: production assistant runtime behavior, hosted authentication,
  provider credentials, a second eval framework, or broad rewrites of existing
  live scenarios.

## Constraints

- Technical constraints: preserve the hermetic provider-key mode; make normal
  Codex-home access explicit and local-only; never copy, print, or persist auth
  material; require a test-name filter so the helper cannot accidentally run
  the entire paid suite.
- Product/process constraints: use synthetic private-free scenarios, derive
  prompts and tools from production builders, assert owned effects and absent
  bad actions, and read every user-visible reply for clarity, warmth,
  correctness, autonomy, and non-repetition.

## Risks and mitigations

1. Risk: subscription convenience weakens the existing credential-isolation
   boundary.
   Mitigation: gate it behind an explicit auth mode, pass only a minimal home
   environment, leave `CODEX_HOME` unset, and keep provider mode unchanged.
2. Risk: live-model tests become costly or flaky approval theater.
   Mitigation: require deterministic boundary proof first, a required focused
   name pattern, effect-level assertions, and human review of the actual reply;
   keep deterministic tests authoritative.
3. Risk: workflow prose adds ceremony without changing behavior.
   Mitigation: provide one canonical command, validate it through focused unit
   tests and one real subscription run, and route agents directly to a concise
   repo-local skill.

## Tasks

1. Add explicit local-subscription support to the live Codex test harness while
   preserving isolated provider-key behavior.
2. Add a guarded one-command focused runner and deterministic runner tests.
3. Initialize and write the `verify-murph-assistant` skill, then allowlist and
   validate its metadata.
4. Wire the skill and live reply-review requirement into the completion,
   verification, and testing guidance.
5. Run focused deterministic proof and one selected real subscription journey;
   inspect its replies and tool effects.
6. Complete ReviewGPT, exact-head CI, plan closure, and PR handoff.

## Decisions

- Reuse the existing `assistant-codex-real-e2e.test.ts` lane instead of adding a
  parallel eval system.
- Keep subscription access explicit through `MURPH_REAL_CODEX_AUTH=subscription`;
  provider-key execution remains the default low-level harness behavior.
- Require the runner's test-name pattern so local convenience cannot fan out to
  every paid scenario accidentally. Enumerate tagged live tests first and run
  only one exact, escaped leaf name.

## Progress

- PR #2253 merged after its exact head passed ReviewGPT, both host matrices,
  the Ubuntu release aggregate, hosted Stripe boundary, Temporal compatibility,
  and a clean current-main merge-tree proof. Its task worktree was retired and
  branch history preserved.
- Added the guarded runner, explicit subscription auth mode, skill, and durable
  workflow routing. Focused runner and harness tests pass, and the skill
  validator accepts the package.
- ReviewGPT found that a regular-expression selector could match several paid
  journeys. The runner now enumerates only tagged live tests and refuses zero
  or multiple matches before login or model execution; the accepted live leaf
  is then run with one exact escaped matcher. Focused tests cover both refusal
  paths, the single-match path, and subscription/provider auth behavior.
- The corrected focused adaptive-wearable journey passed on `gpt-5.6-terra`
  through local subscription auth. All six synthetic paths produced the
  required effects: private timing/off preferences were saved once, a group
  mutation was blocked and redirected to private chat, unsupported Fitbit
  stayed unchanged, ordinary stale data stayed quiet, and reauthorization sent
  one reconnect link. The final-head rerun produced overly cautious
  confirmations after both successful private preference writes; the operator
  accepted that stochastic wording as non-blocking for this tooling-only PR.
- ReviewGPT's proposal to copy the normal Codex profile into an isolated home
  was rejected by the operator. Normal local subscription auth is intentional
  for this developer-only command; the provider-key lane remains isolated.
- ReviewGPT's exact-head round found that a newly merged child-model live leaf
  stored its multi-agent requirement in provider-only TOML and hard-coded the
  parent model. The accepted correction keeps the three required dotted
  `configOverrides` on that leaf and uses the resolved model for execution and
  usage attribution. The exact subscription-backed child leaf passed with a
  Sol parent and Luna child, without depending on ambient profile settings.

## Verification

- Commands to run: focused repo-tool tests, focused live-harness unit tests,
  Assistant Engine typecheck, skill `quick_validate.py`, doc/readback checks,
  and `pnpm test:assistant:live -- --test <adaptive-wearable-pattern>`.
- Expected outcomes: deterministic checks pass; the selected `gpt-5.6-terra`
  subscription journey calls the expected Murph tools, avoids forbidden calls,
  and produces replies that pass the documented UX review.
