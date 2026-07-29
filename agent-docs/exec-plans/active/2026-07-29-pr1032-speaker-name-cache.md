# PR 1032 Linq speaker-name cache

## Problem

Linq group speaker labels are resolved through one set-based Web read, but the
existing memo lasts only for one compound turn. Ordinary turns in the same warm
runner therefore repeat the presentation-only database read even when the
runtime owner, room, sender, and label have not changed.

## Outcome

Keep Web as the sole profile/contact policy authority while making routine warm
turns reuse recent display-only results. Preserve exact-message participant
effect authority and fail soft to an unnamed transcript whenever label evidence
is absent or invalid.

## Smallest architecture

- Move the only cache owner to the assistant-runtime Linq presentation reader.
- Retain one operation-local memo for initial and live-admitted inputs.
- Add one module-private, bounded native `Map` for warm-process reuse.
- Key entries by the trusted runtime member, exact Linq room conversation key,
  channel, and normalized sender handle.
- Use a fixed one-hour TTL for validated labels and five minutes for a valid
  successful omission.
- Keep lookup failures operation-local; never process-cache them.
- Add no timer, single-flight coordinator, invalidation service, persistence,
  schema, dependency, configuration, queue, or distributed cache.
- Delete the assistant-engine memo so the runtime reader is the only owner.

## Invariants

- Cached names remain presentation only and never become membership, routing,
  matching, consent, or participant-effect authority.
- Web retains profile-name precedence, owner-contact provenance, exact current
  room policy, ambiguity/suspension checks, and least-data reads.
- Opaque accepted-message references plus trusted server derivation remain the
  participant-action authority.
- Direct Murph, Telegram naming, message admission, compound-turn ordering,
  and the one-second optional Linq lookup deadline remain unchanged.
- Cache keys, handles, names, and provenance are never logged or persisted.

## Verification and completion

- Focused assistant-runtime cache, scope, TTL, failure, and eviction coverage.
- Assistant-engine regressions proving all prompt paths delegate to the reader.
- Truthful `pnpm test:diff` over every changed runtime and test owner.
- Required local product-experience review for cross-turn name freshness.
- Exact-head preliminary `completion-specialists` ReviewGPT coverage pass.
- Parent final review followed by final ReviewGPT correction round and green CI.
- Resolve the current `main` conflicts before the exact-head review gates.
