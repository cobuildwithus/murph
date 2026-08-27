# Repair group/private handoff continuity and causal delivery

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Restore one coherent group/private conversation: Murph uses a safe known
  speaker label, can consult the current speaker privately, carries a returned
  handoff into the next group turn, and delivers consultation results in causal
  order with self-contained copy.
- Fix the existing owners by deleting accidental machinery or correcting their
  public contracts; do not add another queue, session owner, identity store, or
  compatibility layer.

## Success criteria

- The published `group_consult` schema exposes every action its description asks
  Codex to call, and a focused real-Codex group turn uses the private-current-
  speaker action rather than claiming private context is inaccessible.
- A private-to-group handoff carries a trusted, group-safe speaker label when
  one already exists and remains neutral when none exists.
- An isolated handoff and the next ordinary group message use one canonical
  session, and the next provider input includes the handoff transcript.
- An Assistant Ask completion is preferred before newer unrelated private work
  can overtake it; any unavailable result is understandable without hidden
  prior context.
- One reusable, production-derived synthetic group-chat live harness proves the
  complete flow without production data or delivery providers.
- Focused tests, affected typechecks, live Codex journeys, exact-head CI, four
  user-requested ReviewGPT reviews, and parent final review leave no unresolved
  accepted finding.

## Scope

- In scope: group consultation tool schema/prompt guidance, existing trusted
  handoff metadata, notification turn configuration, session continuation,
  Assistant Ask outbox ordering/copy, synthetic deterministic and live-Codex
  proof, and one member-visible changelog item.
- Out of scope: new persisted state, new authorization or consent semantics,
  new routing/delivery services, production data fixtures, frontend work, and
  broad assistant/session refactors.

## Constraints

- Technical constraints: preserve Web-owned membership, sender, route, and
  replay authority; keep personal health context private until the existing
  explicit handoff; reuse the canonical session, mailbox, and outbox owners;
  remove the notification-only read-only sandbox unless direct proof shows an
  independent security boundary requires it.
- Product/process constraints: this is a Product UX Patch restoring an existing
  promise. Use synthetic, non-identifying scenarios; keep messages concise,
  truthful, and causal; run prompt guidance and live-model verification before
  candidate review.

## Risks and mitigations

1. Risk: removing the read-only override could permit an isolated context turn
   to produce unintended effects.
   Mitigation: retain the existing isolated-turn effect suppression and prove
   zero tools/effects in deterministic and live journeys; do not replace the
   sandbox with another permission profile.
2. Risk: a server-provided label could be mistaken for identity authority.
   Mitigation: reuse only the existing group-safe presentation label and keep
   authorization bound to trusted membership identifiers outside model text.
3. Risk: fixing session reuse alone could still resume a provider thread that
   never saw detached context.
   Mitigation: exercise notification followed by an ordinary group turn through
   production planning; clear only the existing resume cursor if that composed
   proof demonstrates it is required.
4. Risk: an ordering fix could delay foreground replies.
   Mitigation: change preference inside the existing due-intent drain, add no
   waits or network calls, and prove bounded causal ordering with later input.

## Tasks

1. Trace current prompt/schema, handoff metadata, notification/session, and
   completion/outbox owners on current `main`; write failing boundary and
   composed-flow tests first.
2. Implement deletion-first fixes at those owners and update live architecture,
   reliability, security, and prompt contracts only where behavior changes.
3. Extend the existing real-Codex suite with a reusable synthetic two-member
   group/private harness and focused journeys for consultation plus handoff
   follow-up.
4. Run focused tests, affected typechecks, live Codex journeys, Product UX
   walkthrough, provider-input measurement, privacy scan, and candidate review.
5. Commit and push an exact candidate, open a draft PR, and run four distinct
   ReviewGPT threads: architecture/simplification, prompt/Product UX,
   coverage/live-flow proof, and cross-cutting correctness/privacy/reliability.
6. Resolve only verified, proportional findings; rerun affected proof, finish
   the plan/commit, and require green exact-head CI before completion.

## Decisions

- Prefer deleting the notification-only read-only sandbox over teaching session
  persistence another override exception.
- Reuse existing trusted label metadata rather than adding a name-resolution
  state machine or model memory preflight.
- Reuse the existing hosted runtime and real-Codex test owners for the new
  harness; do not create a parallel group-chat simulator.

## Verification

- Commands to run: focused Assistant Engine, Assistant Runtime, Hosted
  Execution, Web, and hosted-local integration suites selected after owner
  tracing; affected package typechecks; `pnpm test:assistant:live` with unique
  synthetic journey names; provider-input measurement; `git diff --check` and
  privacy-sensitive diff inspection; exact-head CI and ReviewGPT gates.
- Expected outcomes: every deterministic regression fails on base and passes on
  head; the live assistant uses the correct consultation tool and responds from
  injected context; no isolated-turn side effects occur; completion ordering is
  causal; all checked replies receive a `Ready` UX verdict.

## Product UX Patch

- Outcome: people in an existing group can ask Murph to use one participant's
  private context and continue naturally without false limitations, lost
  context, ambiguous attribution, or late orphaned replies.
- Reaches: existing private-to-group handoffs, group-to-current-speaker
  consultations, the next group follow-up, and the private completion response.
- Proof: one synthetic end-to-end journey crosses both conversations and the
  canonical hosted owners, while focused real-Codex journeys review the actual
  tool choice and member-visible replies.
