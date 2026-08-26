# Make real-Codex assistant verification one command

Status: completed
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
- ReviewGPT's next exact-head round found that the group reconsideration live
  leaf still hard-coded Sol. It now uses the runner-selected model, and both
  initial and resumed provider usage records must identify that model.
- The required non-Sol proof then exposed a real production ambiguity: Terra
  consistently treated answer text visible in the resumed provider thread as
  delivered even though the group draft was held. The reconsideration context
  now states that requests answered only in earlier undelivered response text
  remain unanswered. The exact Terra journey subsequently passed with both
  answers in one reply and no review mechanics in user-visible text.
- ReviewGPT's full-snapshot round found that this group journey asserted but
  did not print the final member-visible reply, preventing the required human
  `Ready`/`Hold` review. The leaf now emits one compact synthetic scenario and
  final-reply line through the existing live-harness stdout convention.
- The corrected canonical Terra run visibly printed “13 plus 8 is 21, and 7
  times 6 is 42.” and passed all model, resume, content, and internal-language
  assertions; manual reply verdict: `Ready`. ReviewGPT round 6 completed a
  full-snapshot audit of the resulting head with `PASS` and no material finding.
- Exact-head PR evidence, both CLI host matrices, build/typecheck, assistant,
  CLI, and platform coverage, app verification, fixture and bundle gates,
  foreground cardinality, billing, artifacts, marketing overflow, Vercel, and
  Temporal compatibility all passed.

## ReviewGPT round-3 retrospective

- **Original requirement:** provide one guarded developer-local command that
  runs exactly one existing production-derived live assistant journey through
  intentional normal local subscription auth or the existing isolated
  provider-key lane, exposes real effects and replies for a `Ready`/`Hold`
  decision, makes no paid request in routine CI, and changes no production
  assistant behavior.
- **Baseline comparison:** the immutable first-reviewed head changed 13 files
  with 614 additions and 17 deletions (631 lines). The reviewed direction
  changes 14 files with 984 additions and 49 deletions (1,033 lines), growth of
  402 lines (about 64%). Authored production-source churn remains zero.
- **Growth attribution:** the accepted selector correction added the live tag
  and config, list-before-login exact-one admission, escaped exact-leaf
  execution, deterministic process seam, and zero/multiple/single-match tests.
  Documentation made that contract required and discoverable. The child-model
  correction was subtractive: it removed auth-branch-specific multi-agent TOML
  ownership and hard-coded model attribution, then reused the existing
  per-turn override boundary. Normal main integration supplied that child leaf
  and required one composed resolver input; it did not add another task owner.
- **Concepts retained:** one root runner, the existing live-harness file, one
  generic live tag, Vitest collection as admission authority, an exact
  collected leaf as paid-execution authority, one injected command seam for
  deterministic process proof, the repo-local skill, and workflow routing.
- **Concepts removed or rejected:** raw nonempty-regex authority over paid
  execution, auth-branch ownership of leaf-specific capability settings, and
  hard-coded parent model attribution are removed. Copying the normal local
  Codex profile remains rejected; normal developer-local subscription auth is
  intentional, while provider-key mode keeps its isolated home.
- **Indivisibility decision:** continue as one feature. The executable gate,
  skill, and workflow docs form one acceptance path; splitting them would ship
  either an undiscoverable and unenforced safety command or instructions that
  reference absent behavior.
- **Selector decision:** retain human-friendly pattern input for discovery,
  then require exactly one collected tagged leaf and execute its escaped full
  name. A separate leaf-ID registry would duplicate Vitest ownership and add
  maintenance without improving the paid boundary.
- **Direction:** explicitly justified continuation at the 14-file shape. Keep
  the existing owners above and add no framework, identifier registry, auth
  copy, runtime branch, state owner, or dependency. The review-driven growth is
  deterministic proof and durable workflow adoption for the demonstrated
  accidental paid-fanout risk.
- **Why this is smallest:** it reuses the existing real-Codex harness, Vitest
  tags and listing, per-turn Codex overrides, normal subscription login,
  isolated provider mode, and repository workflow system. The only new
  executable owner is the focused runner, and its process seam exists solely
  to prove invalid cardinality stops before login or paid execution.

## Round-4 direction addendum

- The live-model correction remains inside the chosen harness and adds no new
  owner, state, dependency, registry, or runtime branch. Usage assertions sit
  on the existing provider-usage extractor.
- The original tooling-only scope changed only where the required live proof
  demonstrated an existing user-visible failure. The production correction is
  a declarative clarification on the existing reconsideration seam,
  with one focused local-service regression; weakening the journey or keeping
  a hidden Sol override would conceal the demonstrated failure.
- This is one indivisible correction: the runner model must reach the leaf, the
  usage evidence must prove both turns, and the production instruction must
  make the already-promised rapid-group behavior hold on the default model.
  There is no separate feature or framework to split out.

## Verification

- Completed outcomes: runner tests passed 8/8; the deterministic real-Codex
  harness passed 8 with 82 opt-in leaves skipped; the focused local-service
  live-input regression and Assistant Engine typecheck passed; docs drift and
  diff/privacy checks passed.
- Live outcomes: the adaptive-wearable Terra journey passed every effect
  assertion with its accepted wording `Hold`; the child-model journey proved a
  Sol parent and Luna child; the group reconsideration Terra journey passed
  repeatedly and its final printed member reply received `Ready`.
Completed: 2026-08-25
