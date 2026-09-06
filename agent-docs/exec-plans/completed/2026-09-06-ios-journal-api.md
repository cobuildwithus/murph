# Native Journal projection access

## Outcome and invariant

Members browse the existing private Journal in the native app. Canonical records
and the query projection remain the only data owners; no page-open analysis,
new health store, or Home/Patterns behavior changes.

## Implementation

- Add one bearer-authenticated Journal read using the existing encrypted core shard.
- Share ready-session decoding with the browser loader, including exact member binding.
- Recheck current member access and consent after the external read.
- Return only Journal and freshness with no-store response headers.
- Native uses ephemeral networking, session-fenced memory, weekly progressive
  disclosure, native calendar selection, and event detail sheets.

## Product UX and proof

Exercise populated, sparse, empty, unavailable, stale, retry, calendar jump,
older-week scrolling, travel time zones, and session teardown journeys.
Run focused route/auth/decoder tests and Web typecheck; native build/tests and
simulator proof live with the counterpart app change. Deploy the additive API
before releasing the app; an old server yields a recoverable unavailable page.
No foreground assistant operations or database collection fanout are added.

## Progress

- Backend complete: 29 focused route/loader tests, Web typecheck, and complexity guard pass.
  Loader complexity decreases by one; unchanged shard-loading hotspot retains existing behavior.
- Native implementation and session tests pass; native simulator interaction proof
  is owned by the counterpart app checkout and recorded there.
- Independent native review found approximate-time display and repeated Today navigation
  bugs; both corrected and covered in focused proof.
- Changelog decision: API-only counterpart is a foundation until a native release;
  no independently available member change to announce from this backend commit.
- Cross-cutting native review used the required local independent review lane;
  no pushed PR or deployment is part of this local handoff.
Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
