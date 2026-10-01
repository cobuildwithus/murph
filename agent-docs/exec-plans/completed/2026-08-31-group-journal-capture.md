# Group-Derived Journal Capture

## Outcome

Murph follows the approved Journal plan in authenticated groups. After one
private global consent, it saves clear current-sender facts to that member's
private Journal, asks privately when one useful clarification is needed, and
ignores weak or third-party claims.

## Scope

- Reuse exact current-sender authority and the existing private member runtime.
- Reuse the canonical Journal note write path.
- Add the smallest durable consent and opt-out state required by the plan.
- Support one global first-capture consent, one group opt-out, and one global
  opt-out through Murph.
- Keep every capture, question, correction, and follow-up private.
- Add deterministic prompt, authority, persistence, and effect tests.
- Add focused synthetic real-Codex journeys for save, ask, and ignore.

## Product UX

Feature effort. A clear first-person fact should need no repeated confirmation
after consent. An ambiguous fact gets at most one focused private question.
Jokes, quotes, third-party claims, and unclear ownership stay quiet.

Affected people:

- a member sharing a clear fact in an authenticated group;
- a member whose statement needs one clarification;
- another participant mentioned in the conversation;
- a member who has not consented or has opted out;
- group participants who must not learn that a private Journal changed.

## Simplicity Boundary

- No new service, queue, policy engine, capture history, or consent framework.
- No automatic capture from unauthenticated or email group input.
- No copy of another participant's statement into the member Journal.
- No group-visible confirmation and no recall of private Journal data.
- No speculative reprocessing of old group transcripts.

## Proof

- Real model journeys prove high-save, medium-private-ask, low-ignore, and
  first-consent behavior. They check decisions and effects, not prompt wording.
- Exact sender authority binds every write or private question to the accepted
  authenticated group input.
- Canonical persistence tests prove consent, per-group opt-out, global opt-out,
  replay safety, and no third-party write.
- Focused real-Codex journeys prove the actual save, ask, and quiet outcomes.

## Completion

- [x] Exact current-sender authority gates every group action.
- [x] One global consent and per-group or global opt-out persist in existing
      member and membership records.
- [x] The encrypted mailbox delivers accepted facts to the private canonical
      Journal writer.
- [x] Factor and context notes use stable Patterns tags. Plans stay excluded.
- [x] Deterministic tests cover parsing, authority, consent, opt-out, replay,
      privacy, and canonical import.
- [x] A focused real-Codex journey produced high-save, medium-private-ask, and
      low-ignore behavior. Its first consent question retains every clear fact from
      a multi-fact message.
Status: completed
Updated: 2026-08-31
Completed: 2026-08-31
