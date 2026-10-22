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

Parent owns candidate integration and final review. Integrate the lifecycle
branch's exact-pair candidate resolver and pass its host-only player pair through
the photo command. Consumer-first runtime parser rollout and refresh are required
before emitting the expanded read state. Full first-provider-input byte capture
against base eff32234e7 is unchanged for direct turns (155,921 bytes) and increases
Linq group input from 136,129 to 141,507 bytes (+5,378; 3.95%). The exact model
tokenizer is unavailable; no token estimate is substituted. Six planning cases
prove photo tool and guidance are limited to current hosted Linq group input. Final CI, final review, deployment and
production replay remain outside this draft candidate's completed proof.
