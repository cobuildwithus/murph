# group-chat-artifact-silence

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Correct the merged group-chat first-refusal prompt so an audience-unclear,
  unaddressed personal artifact produces immediate silence instead of an
  ineffective foreground wait, while later causal turns remain independently
  eligible.

## Success criteria

- The prompt, skill, and durable product spec require immediate no-text,
  no-reaction completion for the audience-unclear artifact case.
- Existing causal-turn boundaries remain unchanged: same-purpose human captions
  stay silent, while later factual requests or direct Murph addresses can receive
  one answer.
- Focused automation and prompt tests pass, CI is green, and ReviewGPT accepts the
  exact pushed correction.
- The follow-up PR is merged and its worktree is retired.

## Scope

- In scope: the group-chat prompt/skill/spec wording, focused tests and opt-in
  real-model probe, exact-head review, CI, and landing.
- Out of scope: changing native reply grouping, merging participant turns, adding
  cross-turn state, or changing general mid-volley watch behavior.

## Constraints

- Technical constraints: preserve current automation admission and causal-turn
  ownership; do not add state or lifecycle machinery.
- Product/process constraints: the first artifact turn must add no artificial
  delay or typing-indicator wait; later messages are evaluated in their natural
  turns.

## Risks and mitigations

1. Risk: broad wording could suppress genuinely open factual or task requests.
   Mitigation: scope the immediate-silence rule to unaddressed personal artifacts
   whose human audience is unclear, and preserve explicit open-premise handling.
2. Risk: a unit test could bypass production automation admission.
   Mitigation: prove native-reply and different-actor deferral through the actual
   automation selection path and keep real-model probes opt-in.

## Tasks

1. Remove the artifact-specific foreground watch and specify immediate silence.
2. Replace invalid direct-injection proof with production-path automation
   coverage and add an audience-unclear real-model candidate.
3. Run focused verification, product review, preliminary specialists, and parent
   final review.
4. Commit, push, open the follow-up PR, run final ReviewGPT with CI, resolve any
   findings, merge, and retire the worktree.

## Decisions

- Accept final ReviewGPT round 1's finding from PR #1060: the foreground active
  turn cannot observe native-reply or different-actor messages that belong to a
  later causal turn.
- Use deletion as the correction: immediate terminal silence for the narrow
  ambiguous-artifact case; no grouping or admission changes.
- Accept preliminary ReviewGPT's coverage finding on PR #1075: the real-model
  candidate must distinguish a text reply, reaction, short watch, and immediate
  no-output completion, with an explicitly open artifact as the answerable
  control.

## Verification

- Commands to run: focused assistant-engine Vitest suites, `pnpm test:diff` for
  touched files, `pnpm verify:acceptance`, exact-head GitHub checks, preliminary
  and final ReviewGPT.
- Expected outcomes: focused suites and required CI pass; any unrelated local
  verification blocker is reproduced or clearly isolated; ReviewGPT returns
  `ROUND_OUTCOME: PASS` for the correction head.
- Current evidence: focused assistant files passed; the canonical diff run
  passed all touched owners and affected typechecks before unrelated CLI tests
  timed out behind a contended prepared-runtime lock. The opt-in real-model
  command remains credential-bound because neither supported provider key is
  available in the current process environment.
