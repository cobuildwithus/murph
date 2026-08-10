# Sponsored group funding recovery

Status: completed
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Keep group funding privacy intact while ensuring a low or exhausted room can
  hear a conversational continuity prompt and receives a current first-party
  funding action at the actual pause boundary, even when an automatic sponsor
  already exists.

## Success criteria

- Group funding urgency follows the canonical low/exhausted capacity state,
  independent of the binary sponsored/unsponsored privacy projection.
- The first assistant-initiated low-usage mention remains link-free,
  reply-oriented, and free of payer, cap, charge, balance, refill, percentage,
  or message-count details.
- The deterministic exhausted-room notice rechecks current authority and
  appends the current first-party group funding URL for both sponsored and
  unsponsored rooms.
- A sponsored room may explain only the additional one-time contribution path;
  it never implies that a second automatic sponsor can be created.
- Focused tests, relevant type proof, exact-head CI, preliminary specialist
  review, and final ReviewGPT complete with no unresolved findings.

## Scope

- In scope: the Web-owned group funding urgency projection, deterministic
  exhaustion copy projection, hosted low-usage assistant policy, focused tests,
  and owning durable documentation.
- Out of scope: sponsor identity or financial disclosure, automatic cap changes,
  a second sponsor, a new notice lifecycle, usage-meter repricing, model
  switching, or an operator-only production message system.

## Constraints

- Reuse the existing group funding URL, capacity gate, usage-notice claim, and
  delivery-time route reauthorization.
- Preserve the rule that low usage is surfaced only on a later allowed
  conversation turn, while exhaustion uses the existing deterministic notice.
- Keep every public group projection qualitative and privacy-safe.
- Add no schema, queue, scheduler, persisted forecast, or second state owner.

## Tasks

1. [completed] Align the canonical urgency projection and exhaustion message
   with the requested sponsored-group recovery behavior.
2. [completed] Update assistant policy, durable docs, and focused regressions.
3. [completed] Run focused tests, relevant type proof, and candidate diff review.
4. [completed] Push the exact candidate, open the PR, and run preliminary and
   final ReviewGPT concurrently with CI.
5. [completed] Resolve accepted findings, close the plan through the scoped final
   commit path, and report the production RCA without identifiers.

## Decisions

- Treat sponsorship status as a privacy and available-payment-path fact, not as
  evidence that low capacity is harmless. A live sponsor no longer suppresses
  urgency when the canonical capacity state is low or exhausted.
- Keep the first warning link-free so the room can reply naturally; the actual
  pause notice is the recovery boundary where the already-authorized funding
  URL becomes necessary.
- Keep monthly sponsorship singular. When a sponsor already exists, the
  funding page and assistant describe only an additional one-time contribution.
- Keep sponsored exhaustion factual and deterministic: the neutral pause is
  followed by one fixed private-recovery line and the validated first-party
  URL. The sponsored branch never uses the randomized unsponsored funding
  corpus, nominates a payer, or promises immediate restoration.

## Verification

- Focused Web Vitest: 30 tests passed across the group-usage projection and
  exhaustion notice projection.
- Review remediation Vitest passed 111 tests across the exact notice, message
  corpus, sponsored funding page, verified Stripe grant, and runtime recheck.
  Six stable-owner recovery suites passed 173 tests covering crossing
  accounting, exact-route notice delivery and claiming, denied-gate retries,
  the sponsored one-time page, verified grants, and mandatory runtime rechecks.
- Focused Assistant Engine Vitest: 13 hosted low-usage skill contract tests
  passed.
- Web and Assistant Engine typechecks passed after generating the ignored
  Health Commons catalog required by the isolated worktree.
- Agent-docs drift checks passed after the owning index entries were updated.
- Focused Web ESLint passed for both changed source files and both regression
  files.
- `pnpm test:diff` passed dependency policy, workspace boundaries, hosted
  runtime architecture guards, every affected-package typecheck, 3,207
  Assistant Engine tests, 128 Assistant CLI tests, 2,073 Assistant Runtime
  tests, and 40 Assistant daemon tests. Its later unrelated CLI source leg
  timed out in pre-existing session-list, self-target, and removed-base-URL
  cases; one session-list case reproduced alone with 37 sibling tests skipped.
  No changed file reaches those command paths, so exact-head CI remains the
  broad gate.
- Complete first-provider request capture used the pinned real Codex App
  Server, local scripted Responses provider, `gpt-5.6-terra`, low reasoning,
  production code mode, 16 representative direct tools, 13 representative
  group tools, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It counted `input`,
  `tool_choice`, `parallel_tool_calls`, `include`, and `text`, including Codex
  base instructions, Murph developer instructions, deferred-tool metadata,
  schemas, and generated guidance; it excluded transport, cache, account,
  model-selection, reasoning, storage, and streaming metadata identically and
  normalized temporary paths. Direct measured 31,223 tokens / 142,165 bytes
  and group measured 27,280 tokens / 125,217 bytes at both base and head (zero
  delta). The changed skill body is read after that initial request and is not
  eagerly included in it; the authored delta is isolated to
  `hosted-low-usage/SKILL.md` and its focused prompt contract.
- A sponsored-low real Codex two-turn scenario now exercises current-task-first
  warning behavior and the broad-options follow-up. Its opt-in live run was
  blocked before model execution because neither supported provider-key
  environment is configured locally; static collection and Assistant Engine
  typecheck passed.
- Preliminary ReviewGPT found the same randomized-copy defect plus the missing
  real-model sponsored-low scenario. Both were remediated. Its request for one
  authentication-through-Stripe-through-Temporal mega-test was rejected after
  ownership tracing because those unchanged owners already have stronger
  stable-boundary proof and a single test would only restub them or create
  external side effects.
- Final ReviewGPT round 1 found the randomized sponsored copy and malformed-URL
  fallback defects. The remediation uses fixed factual copy and preserves the
  sponsored neutral fallback. Final round 2 passed the remediation with no
  qualifying unresolved finding.
- Required GitHub Actions passed on both implementation heads. The final
  plan-archive-only head retains the same reviewed code and must rerun CI, but
  does not require another ReviewGPT round.
Completed: 2026-08-07
