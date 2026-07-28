# group-chat-artifact-silence

Status: completed
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

- Focused assistant-engine verification passed twice on the reconciled head:
  93 tests passed and 6 credential-gated real-model tests skipped.
- Canonical `pnpm test:diff` passed repository guards, all affected typechecks,
  and every touched owner. The reverse CLI lane reproduced unrelated
  prepared-runtime lock timeouts and pre-existing experiment journal/vault
  failures; no task-path test failed.
- Assistant-engine owner coverage passed with 2,778 tests and the repository's
  documented single-worker heap settings. After reconciliation, remote
  acceptance passed with 2,799 assistant-engine tests and coverage above all
  thresholds.
- Canonical `pnpm verify:acceptance` passed on the exact pushed head through the
  documented Crabbox-backed Blacksmith lane, including full workspace package
  coverage, app verification and builds, and Cloudflare worker tests.
- Preliminary ReviewGPT identified one coverage gap: distinguish text, reaction,
  short watch, and immediate silence in the real-model candidate matrix, with an
  explicitly open artifact control. The correction is present in this head; no
  specialist patch artifact was supplied.
- Product-experience review returned no findings and confirmed that immediate
  silence preserves the human-owned floor while direct or genuinely open asks
  retain the shortest truthful answer path.
- Parent final review found no conflict between human-owned private/social
  questions, directly addressed uncertainty, and genuinely authorized open
  requests; safety precedence and causal-turn boundaries remain unchanged.
- The opt-in live real-model probe remains credential-bound because neither
  supported provider key is available in the current process environment.
- Remaining landing gates: exact-head final ReviewGPT pass, required GitHub
  checks, merge, and worktree retirement.
Completed: 2026-07-28
