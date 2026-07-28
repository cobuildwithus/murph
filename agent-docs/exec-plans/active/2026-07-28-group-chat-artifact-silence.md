# group-chat-artifact-silence

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Correct the merged group-chat first-refusal prompt so an audience-unclear,
  unaddressed personal artifact produces immediate silence instead of an
  ineffective foreground wait, while later causal turns remain independently
  eligible.
- Generalize the same floor principle so question grammar cannot convert a
  human-source interpersonal or shared-history beat into an open Murph request,
  and a correction after an interruption receives silence rather than a
  compliance performance.

## Success criteria

- The prompt, skill, and durable product spec require immediate no-text,
  no-reaction completion for the audience-unclear artifact case.
- Existing causal-turn boundaries remain unchanged: same-purpose human captions
  stay silent, while later factual requests or direct Murph addresses can receive
  one answer.
- Floor ownership is classified by truthful answer authority before punctuation:
  unaddressed human-source social questions stay silent, answerable public or
  authorized requests remain eligible, and direct unverified person-fact asks get
  one plain uncertainty sentence.
- A complaint that Murph inserted itself terminates without an apology,
  acknowledgment, reaction, or backing-away bit unless the same message contains
  an independent ask.
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
- Privacy constraint: use synthetic, structure-equivalent scenarios only; do not
  copy user transcripts, participant names, or distinctive private details into
  prompts, tests, or documentation.

## Risks and mitigations

1. Risk: broad wording could suppress genuinely open factual or task requests.
   Mitigation: use a source-of-truth test — public/general knowledge, the visible
   conversation, server-approved group evidence, or an available task tool remains
   eligible; private relationship, conduct, or shared-history knowledge remains
   human-owned.
2. Risk: a unit test could bypass production automation admission.
   Mitigation: prove native-reply and different-actor deferral through the actual
   automation selection path and keep real-model probes opt-in.
3. Risk: a direct Murph ask about an unverified person-fact could become either
   speculation or an overlong refusal.
   Mitigation: require one plain uncertainty sentence and explicitly forbid a
   comic abstention, mock ruling, or hidden-record implication.

## Tasks

1. Remove the artifact-specific foreground watch and specify immediate silence.
2. Replace invalid direct-injection proof with production-path automation
   coverage and add an audience-unclear real-model candidate.
3. Add the floor-follows-authority rule to the group core prompt, required skill,
   durable spec, static contracts, and synthetic real-model candidate matrix.
4. Prove that an interruption complaint receives no compliance reply while a
   genuinely answerable open factual request remains eligible.
5. Run focused verification, product review, preliminary specialists, and parent
   final review.
6. Commit, push, update the follow-up PR, run final ReviewGPT with CI, resolve any
   findings, merge, and retire the worktree.

## Decisions

- Accept final ReviewGPT round 1's finding from PR #1060: the foreground active
  turn cannot observe native-reply or different-actor messages that belong to a
  later causal turn.
- Use deletion as the artifact correction: immediate terminal silence for the
  narrow ambiguous-artifact case; no grouping or admission changes.
- Classify open requests by truthful answer authority rather than punctuation.
  Question-shaped private relationship, conduct, and shared-history beats remain
  human-owned; public/general, visible-conversation, authorized shared-data, and
  executable task asks remain eligible.
- Treat a joke about not knowing as an interruption, not as silence. A direct ask
  may receive one plain uncertainty sentence; an unaddressed human-source beat may
  not receive a comic abstention.
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
