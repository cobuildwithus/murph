# Resumed Conversation Continuity

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

Keep Murph's bounded, committed recent transcript available on every provider
turn, including native thread resumes, so provider-side compaction cannot erase
recent user-visible conversation context.

## Evidence

- The private workspace export proves the relevant recent input was already
  persisted in Murph's committed transcript before the assistant lost it.
- Production runtime metadata proves the affected turns stayed in one assistant
  session and resumed one provider thread, while every resumed turn explicitly
  omitted Murph's committed transcript from provider input.
- Provider-visible input shrank materially at the asynchronous completion
  boundary. The model then lacked a recent detail still present in Murph's own
  transcript, proving native provider resume alone is not a continuity source.
- Planning and provider code independently enforce the same false choice:
  either resume the provider thread or replay Murph's bounded transcript.
- The separate stuck-note recovery correctly cleared the newly blocked request,
  then found one legacy unresolved guard. Its read-only provider lookup returned
  an authorization-class response, so absence is not proven and the guard must
  remain fail-closed.

## Affected People And Journeys

1. A person supplies task details, receives an asynchronous result, then gives
   a short approval without repeating the recent details.
2. A long-running native provider thread is compacted between two ordinary
   turns; Murph's bounded committed transcript still supplies recent context.
3. A person sends multiple accepted inputs in one turn; each remains a distinct,
   ordered transcript unit with its own retention time.
4. A current prompt is also the latest committed input; it is not replayed a
   second time in the recent-history section.

## Tasks

1. Remove the native-resume branches that suppress the existing bounded
   committed transcript in planning and the provider adapter.
2. Delete the physical-note-specific origin-context carrier, timestamp field,
   runtime propagation, documentation, and tests from the earlier candidate.
3. Persist compound accepted inputs as separate ordered transcript entries via
   the existing accepted-input journal and transcript owner.
4. Add deterministic coverage proving native resume and bounded recent history
   are composed, the current prompt is not duplicated, and compound inputs keep
   independent semantic and retention boundaries.
5. Add one synthetic real-Codex journey that resumes a provider thread without
   usable native context and recovers the needed recent detail from the
   production-built bounded transcript.
6. Update durable continuity contracts and a privacy-safe changelog fragment.
7. Run focused tests and typecheck, ReviewGPT gates, exact-head CI, merge proof,
   and deployment verification.

## Constraints

- Never store or reproduce production transcript text, identifiers, names, or
  addresses in source, tests, documentation, reviews, or release notes.
- Add no new state owner, workflow, queue, provider request, or effect authority.
- Reuse the existing 72-message, 4,000-byte-per-entry, 12,000-byte-total
  transcript projection and its explicit context-only label.
- Preserve the 14-day assistant-input content-retention owner and existing
  completion provenance and ordering boundaries.
- Do not clear a physical-note row without accepted or proven-absent provider
  evidence.

## Verification

- Assistant Engine typecheck passed.
- Focused Assistant Engine suite passed: 331 tests across turn planning,
  provider prompt assembly, local delivery/transcript persistence, and
  automation event admission.
- Deterministic provider proof resumes a native thread while including two
  bounded committed-history messages and verifies the current prompt appears
  exactly once.
- Deterministic transcript proof persists a large older asynchronous result and
  a newer accepted message as two ordered entries with independent receipt
  timestamps and transcript refs.
- `pnpm test:assistant:live -- --test "uses committed recent context missing
  from native provider state"` passed with `gpt-5.6-terra` through local
  subscription auth. The native provider thread intentionally never received
  the synthetic detail; the resumed production path recovered it from Murph's
  committed transcript and replied `Green comet.` on the same session. Reply
  review: Ready.
- Product UX walkthrough: Ready. A member can give a short follow-up after an
  asynchronous result or long-thread compaction without repeating a recent
  detail; current accepted-input authority and ordinary clarification behavior
  remain unchanged.
- Changelog, ReviewGPT, exact-head CI, merge proof, and deployment verification
  remain pending.
