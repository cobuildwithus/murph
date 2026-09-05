# Terra live-suite failures

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Complete the existing live Terra sweep, distinguish assertion defects from
unsuccessful assistant journeys, and fix obvious reproducible issues on current
main without disturbing the running baseline.

## Success criteria

- Account for every journey in the existing sweep, including blocked results.
- Prove each accepted cause before changing its owning boundary.
- Preserve actual effect assertions while excluding read-only CLI help.
- Run focused deterministic tests, package typecheck, and relevant live journeys.
- Review actual synthetic replies, commit the scoped patch, and complete the
  required PR checks.

## Scope

- Confirmed assistant and live-test defects exposed by the sweep.
- No speculative rewrites, production-provider calls, or private member data.
- Changes use an isolated task branch based on current main; baseline results
  remain tied to their original revision.

## Product UX: Patch

- Outcome: supported requests use available results and report completed work
  truthfully; verification measures actual writes instead of help inspection.
- Reaches: direct and group video questions, and any other existing journey
  whose independently reproduced failure admits a small correction.
- Proof: production-composed synthetic turns, exact tool results and effects,
  and manual inspection of the resulting replies.

## Tasks

1. Finish observing the original sweep and classify failures.
2. Reproduce promising failures on current main and inspect owning code paths.
3. Correct proven causes with focused deterministic regression coverage.
4. Run typecheck and affected live journeys; inspect replies and effects.
5. Review scope, document evidence, close this plan, and open the scoped PR.

## Decisions

- Do not modify or terminate the original session's active test runner.
- Current main contains a newer deferred-schema discovery fix; do not duplicate
  it or assume old-revision failures remain current.
- Keep logs and synthetic transcripts in ignored local evidence only.
- Native Codex converts dynamic tool content items to a string in code mode.
  Two independent video traces called a successful tool and then dereferenced
  an MCP content envelope, throwing before reading its result. One short
  instruction at the existing base-instruction owner fixes that misunderstanding.
- Test assertions must retain effect and authority checks while tolerating
  equivalent truthful wording. Negated group subjects are excluded only from
  positive-state detection; a separate positive claim still fails.
- The workout fixture now installs the advertised skill assets and selects
  the running event by type rather than assuming chronological insertion.
- Final ReviewGPT is not routed: prompt-primary guidance plus test fixes and
  static changelog content; no independent authority, protocol, or state change.

## Verification

- Baseline: existing two-process live sweep, model gpt-5.6-terra, local subscription.
- Fixes: selected live tests plus focused deterministic proof and assistant-engine
  typecheck. Record exact commands and results as they complete.

### Completed baseline

- Original revision: caaf41fdeea1842ff5d60e5af6842e65de7b7e8a.
- All 180 journeys accounted for: 119 passed, 60 failed in this sweep, and one
  previously recorded assertion failure. These are first-failing journey
  assertions, not 61 independently established production bugs.
- Every failure is classified in ignored local evidence. Preserve remaining
  model-behavior and assertion gaps rather than weakening their boundaries.

### Focused proof

- Current-main video reproduction failed before the prompt edit and passed
  afterward. Private motion, speech, group video, and empty-result recovery pass.
- Group membership and shared workout reads pass with one tool call. Voice memo
  delivery and ambiguous repeated-set clarification pass.
- Product-feedback and failed-support probes now call the tool once but still
  fail their summary-specificity and additional-help wording assertions. Those
  residual failures are outside the native result parsing correction.
- Deterministic command/help, negated-status, composed-prompt, and support-rule
  checks: six tests pass with the focused Vitest name pattern.
- Changelog: `pnpm --dir apps/web test -- changelog-page.test.tsx`: nine pass.
- Saved-duration live journey passes all four turns, including route duration,
  with real canonical writes and no runtime issue reports. Nine focused live
  journeys pass overall; the two additional feedback probes retain the gaps above.
- `pnpm --dir packages/assistant-engine typecheck`: pass.
- Web typecheck initially lacked the existing device-sync service build output.
  `pnpm --dir packages/device-syncd build` followed by
  `pnpm --dir apps/web typecheck:prepared`: pass; no source workaround.
- Public changelog presentation reference returns HTTP 200 with its archive
  anchor. Content-only entry uses the documented no-preview route.
- Parent Product UX result: Ready for the scoped fix; no claim of a green full
  live suite. PR #2835 retains the complete baseline and residual-gap accounting.
- Complexity: `pnpm complexity:diff --base 0a1616a9e2e7f7ac9127b1455fd9ff9bccd0b9f5`;
  production source debt and hotspots remain zero.

### Complete initial provider input

- Base: 0a1616a9e2e7f7ac9127b1455fd9ff9bccd0b9f5; head prompt matches this patch.
- Capture uses the real pinned Codex app-server against the existing local
  scripted Responses stub, with identical direct/group hosted prompt fixtures
  and code-mode model catalog. No live provider credentials are needed.
- Serialize model, all input messages (including additional-tools), instructions,
  eager/deferred tool definitions, generated guidance, tool choice, parallel
  tool settings, text, and reasoning when present. Transport/cache fields are
  excluded; random message/tool IDs are normalized identically.
- gpt-tokenizer 3.4.0, o200k_base, matching OpenAI tiktoken's GPT-5 prefix mapping.
  These are full serialized input token counts, not provider-billed usage.
- Individual: 23,854 to 23,895 tokens (+41, +0.172%); 111,321 to 111,513 bytes.
- Group: 19,992 to 20,033 tokens (+41, +0.205%); 93,730 to 93,922 bytes.
- Only the base-instruction message changes. All other input parts are identical.
- No awaited operations, database calls, network calls, state, or deploy contracts
  are added. Existing tool/provider and delivery owners remain authoritative.
Completed: 2026-09-04
