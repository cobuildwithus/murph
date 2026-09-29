# Remember conversational language for voice memos

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Outcome and ownership

Private conversations should infer a clear conversational language, use it for
voice memos, and remember it for later turns. Existing canonical memory owns the
note; prompt policy owns interpretation; the existing voice tool owns generation.
No new preference field, language detector, provider call, or persistence owner.
Saved voice identity and voice-output consent remain unchanged.

## Product UX

- Outcome: language follows the conversation without a settings question.
- Reaches: private text and voice conversations, later ambiguous requests,
  explicit permanent changes and temporary overrides, and memory opt-outs.
- Boundaries: quoted language and translation exercises do not replace defaults;
  groups and unverified audiences gain no personal-memory authority.
- Proof: composed prompt and tool tests, canonical memory readback, fresh-turn
  reuse, and focused real-Codex journeys with synthetic audio delivery.
- Done when: focused tests/typecheck pass and actual replies and effects are Ready.

## Evidence and decisions

- Existing speech adapter forwards text with the configured voice. Existing
  instructions save durable context but do not establish language precedence or
  proactive language-memory behavior. Extend those owners only.
- Canonical memory receipts and bounded prompt context retain recovery/readback;
  failed writes cannot justify a saved claim. Existing schemas and API unchanged.
- Planned checks: focused assistant prompt/voice suites, assistant-engine
  typecheck, real-model language-memory journeys, docs drift and complexity guard.
- Review and PR follow the existing completion workflow and authorization.

## Verification outcome

- 238 focused deterministic tests and 10 changelog render tests passed;
  assistant-engine typecheck, docs drift, diff check, and complexity guard passed.
- Focused gpt-6-sol local-subscription journey passed seven fresh turns: text-only
  learning, audio reuse, fresh-session reuse, one-off override, permanent update,
  translation exercise, and memory opt-out. Readback proves one canonical note;
  six speech requests retain the configured voice. UX Ready.
- Initial live sampling skipped a save; policy now explicitly requires saving
  before finishing and says one substantive message is sufficient. The complete
  final journey passed against this stronger policy.
- Default and two alternate subscription homes failed before any provider action;
  the third alternate supplied the final proof without auth inspection or copying.
- Complete native scripted-provider captures: direct request 165167 to 166579
  bytes; group 153145 unchanged. Exact target tokenizer unavailable; no token
  estimate substituted. Excludes only transport prompt_cache_key.
- Existing source complexity remains unchanged. No new runtime state or dependency.
- Candidate reviewed locally for authority, privacy, saved voice, language priority,
  legacy model guidance, and duplicate memory writes. PR review and CI follow on
  the committed candidate; no deployment claim is made by this local proof.
Completed: 2026-09-29
