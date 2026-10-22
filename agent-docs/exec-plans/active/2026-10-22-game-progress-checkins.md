# Shared game progress and explicit chat check-ins

## Outcome

Players can ask about daily check-in status and settled results. In iMessage,
explicitly saving a received photo uses the existing game posting rules. A
contextually relevant photo may introduce this option once per person; that
offer never enables automatic saving of future photos.

## Boundaries and design

Use canonical game settlement, encrypted media, accepted sender identity and
current exact-pair chat authority. Shared progress contains metadata only; no
private labels, captions, excuses or locked images. Fetch only the selected
accepted provider attachment, never a model-selected URL. A pending offer binds
its sender, room, source, game and current day. Member-owned game profile state
records the introduction across games. Ordinary human conversation stays quiet.
No reminders, autonomous score messages or backdated photos are added.

## Product UX and proof

Cover first relevant offer, repeated quiet photos, explicit save, same-sender
continuation, replacement confirmation, time rollover, unavailable attachment,
wrong sender/room, heart-rate challenges, progress and finished results. Run
focused boundary tests, Web/package typechecks and production-derived real-Codex
journeys before parent review. Parent owns final review, merging and deployment.

## Steps

- [x] Trace current shared reads, media ownership and accepted sender authority.
- [x] Implement shared progress and canonical settled results.
- [x] Implement explicit photo import and once-per-person introduction.
- [x] Verify deterministic boundaries, live journeys, docs and changelog.

## Candidate evidence and handoff

Focused proof passed: 74 Web game tests, 16 PostgreSQL game tests, 14 assistant
game-tool tests, two signed transport tests, and Web, assistant-engine,
assistant-runtime hosted-execution and Cloudflare typechecks. The full 122-case turn-planning
suite and 167 dispatcher tests also pass. Complexity and docs drift
guards passed. Eight real-Codex journeys were reviewed as Ready: introduction,
repeat silence (including a new room with no introduction history), explicit save, selected-photo yes, replacement confirmation,
daily progress and settled results. These journeys prove dialogue and tool
effects; they do not claim visual activity verification or production delivery.

The introduction records a conservative once-only attempt, not a delivered
question. Pending approval lasts at most 30 minutes and never beyond the game
day. No qualifying developer-friction entry was created.

## Integrated candidate

Integrated lifecycle head `08ee3bbfc8`, including the negotiated-terms and reader
floor changes. Shared discovery uses the same-pair candidate owner. Photo saves
carry its provider-verified pair through the normal post transaction; no save
rebinds the announcement room. The current requester and original source sender
are revalidated in that room, and the stored offer remains room/day scoped.
Negotiation, encrypted v2 pending words, proposal origin and bootstrap metadata
are preserved. The reader-floor photo-unavailable stub is replaced by the
participant-aware handler now that its feature is present.

All eight live journeys were rerun with read/update/photo tools jointly present
and remain Ready. Combined deterministic proof includes same-pair secondary-room
posting and settlement, wrong-pair rejection, PostgreSQL offer/yes/retry through
the normal post owner, and a stored offer rejected from a different room. The
local PostgreSQL database was initialized with the standard runtime-cutover seed
needed by the existing allowance proof; no production database was touched.

Full first-provider-input capture uses identical fixtures across the rollout
stages. Direct turns remain 155,921 bytes. Group input is 136,129 bytes at base,
138,595 after negotiated terms (+2,466), 138,977 after lifecycle (+382), and
144,355 after progress/photos (+5,378). The combined increase is 6.043%; the
photo slice increases lifecycle input by 3.870%. Exact model tokenization is
unavailable, so no token estimate is substituted. Exact historical tool
snapshots live with the optional measurement fixture.

Parent owns final review, CI, plan closure and deployment. Compatible runtime
consumers and the nullable profile migration must precede the new Web producers;
refresh active runtimes. No native app release or production replay has occurred.
