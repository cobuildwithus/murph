# Plan: sleep summary response card (host-built, envelope 8)

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

Date: 2026-11-03. Repos: `murph` (backend, Web image), `murph-ios` (native view).

## Member outcome

When a member asks generally about a night's sleep ("how did I sleep?",
"how was my sleep last night", "sleep summary"), Murph replies with one sleep
card and no other text. When they ask a specific number ("what was my deep sleep
last night?", "what time did I fall asleep?", "what's my HRV?") Murph replies in
plain text with that number, no card. Compound or advice requests ("how did I
sleep and why am I tired?") stay ordinary text, because a card replaces the
whole reply and must completely satisfy the request (existing card rule).

Card content (owner-approved design, Paper "Murph · Sleep card"): header
"Sleep"; total asleep as the hero; provider score ring only when the wearable
sends one; a stage bar deep/REM/light/awake proportional to minutes with
bedtime and wake time under it; an icon row with wake-ups, efficiency %, HRV ms,
resting HR bpm, showing only numbers that exist. Native taps: bar shows
restorative (deep + REM) and awake; a number opens a short explainer.
Missing data is hidden, never drawn as 0 or a dash. No score means no ring.
No stages means one "ASLEEP" block.

## Wire contract (new): `sleep_summary` V1, envelope schemaVersion 8

Envelope 7 is reserved for the unmerged `wearable_trend` branch; iOS already
decodes 7 as that. Sleep takes 8.

```ts
{
  kind: 'sleep_summary', version: 1,
  localDate: 'YYYY-MM-DD',            // wake date of the night
  bedtime: 'HH:mm' | null,            // member-local wall clock; both or neither
  wakeTime: 'HH:mm' | null,
  totalSleepMinutes: int 1..1440,     // required; no card without it
  score: int 0..100 | null,           // provider sleep score / WHOOP sleep performance
  stages: { deepMinutes, remMinutes, lightMinutes } | null, // all three or null; sum 1..1440
  awakeMinutes: int 1..1440 | null,   // 0 normalized to null by the host
  efficiencyPercent: int 1..100 | null,
  hrv: { milliseconds: int 1..1000, method: 'rmssd' | 'sdnn' } | null,
  restingHeartRate: int 20..250 | null,
  wakeUps: int 0..100 | null,         // always null until an importer exists
}
```

Strict objects everywhere (the Swift decoder requires exact keys). Integers are
rounded by the host before validation. Envelope is identity-free: no member,
provider, source, record ids, or timestamps beyond wall-clock HH:mm. Fragment
URL and image path reuse the existing bounded Base64URL family (< 2,048 chars;
this payload is ~350 bytes).

## Authority: host builds the card; the model passes only a date

New tool `murph.attach_sleep_card({ date: 'YYYY-MM-DD' })`. The model never
passes display values. The host:

1. Calls one new query-owned resolver, `resolveWearableSleepCardNight(vaultRoot,
   { wakeDate })` in `packages/query/src/wearables/` (ReviewGPT P1, accepted). It
   composes existing helpers instead of `wearables day` exact-date selection:
   the bounded adjacent-stored-date read from
   `resolveWearableSleepPatternReadFilters`, the validated reporting-zone lookup
   and `resolveWearableSleepAnalysisDate` (localized sleep end), and explicit
   eligibility that rejects nap, short-sleep and tentative evidence as the
   completed night while keeping total-only and unknown-classification
   evidence (no start/end required). It returns the selected night plus the
   recovery summary for that selected night's stored date. `wearables day`
   semantics stay unchanged.
2. Maps: total = `totalSleepMinutes`; stages only when deep, REM and light are
   all present and sum > 0; awake when > 0; efficiency normalized to percent and
   dropped when 0/out of range; score = `sleepScore ?? sleepPerformance`;
   HRV = sleep `hrv` as RMSSD; else, narrowly in the resolver, the mean of
   canonical `hrv-sdnn` metric points recorded inside the selected sleep window
   (Apple), method `sdnn`; else null (needs a window); resting HR = recovery
   `restingHeartRate` (never average/lowest sleeping HR); wake-ups null.
3. Bedtime/wake = `sleepStartAt`/`sleepEndAt` converted to wall clock in the
   night's `timeZone`, else the member's canonical reporting zone, else both null.
4. Validates with the contract schema and returns `responseCardPatch` through the
   existing attach path (same audience, single-card, no-media, current-delivery
   and steering protections as `attach_response_card`).
5. If there is no total for that date, returns a safe tool error
   (`no_sleep_for_date`) so the model answers in text. No partial card.

Availability: exactly where `responseCardsAvailable` is true (private direct
interactive turns, existing scheduled exceptions). Never in groups.

## Delivery

- **Linq:** reuse `sendLinqIMessageAppCard`. Sleep cards send `interactive:false`
  (one named constant in operator-config). Native delivery is a later,
  separate decision; see Rollout 4. Reason: the
  production App Store extension shows "Murph card unavailable" for unknown
  envelopes, and Linq has no per-recipient app-version capability. With
  `interactive:false`, every recipient (installed app, no app, macOS) sees the
  static image layout. TestFlight builds carry the native view ahead of the flip.
- **Static image (desktop / no extension / interactive:false):** extend
  `apps/web/app/imessage/card/v1/[payload]/route.tsx` to decode envelope 8 with
  the strict contract parser and render `sleep-summary-card-image.tsx`, a
  bitmap mirroring the native default state (hero, ring when score, stage bar
  with labels and times, icon row) at 3.75x of the 320pt card. Same no-store,
  noindex, no-log, no-DB policy. Height varies only with which rows exist.
- **Layout caption:** short wake date ("Tue, Nov 3"); no subcaption.
- **Notification fallback_text:** value-free "Your sleep summary."
- **Text recovery** (capability unavailable, definitive rejection, non-Linq):
  deterministic lines from the card, e.g.
  `Sleep, Tue Nov 3` / `7h 16m asleep, 12:18 AM to 8:02 AM` / `Score 85` /
  `Deep 2h 21m, REM 1h 58m, light 2h 57m, awake 28m` /
  `Restorative (deep + REM) 4h 19m` / `94% asleep, HRV 66 ms, resting HR 45 bpm`.
  Omitted fields drop their segment. No em dashes.
- **Telegram:** one rich message: title, date, static image, a small table of
  the present values.
- Outbox, dedupe, fallback keys, receipts: unchanged; card participates in the
  existing intent identity.

## Instructions

- Tool description (short): host-built sleep card for a general nightly summary;
  never for a single-metric question; whole reply; no media.
- `packages/assistant-engine/skills/sleep-improvement/SKILL.md`: add the
  general-vs-specific routing rule and "after a successful sleep card, end with
  no final text". Keep existing rules (awake minutes are not awakenings; stages
  less reliable than timing/total).
- Update `staticPromptHash` / route-plan snapshots after reviewing the diff.

## Tests and evals

- contracts: schema accept/reject (bounds, strict keys, both-or-neither window,
  stages all-or-none), envelope 8 encode/parse, shared Swift wire fixture.
- builder: synthetic canonical vault nights for Oura (all fields), WHOOP
  (performance score, stage totals, no window tz → canonical zone), Apple Watch
  (no score, SDNN), iPhone-only (total only), Garmin without HRV, zero-filled
  stages, no data → error, timezone wake-date boundary.
- operator-config: text recovery per variant, fallback_text, caption, Linq body
  has `interactive:false` for sleep only, URL bounds.
- Web: route decodes 8, rejects malformed/query-bearing before font reads,
  renders 1200-wide PNG for each variant; `og-assets:runtime-check` probe.
- assistant-engine: tool schema size budget, availability (direct yes, group no),
  attach path rejects second card/media, prompt hash updates.
- Live real-Codex journeys (`pnpm test:assistant:live -- --test "..."`):
  1. "how did I sleep last night?" → exactly one `attach_sleep_card` with the
     wake date, no final text, card delivered.
  2. "what was my deep sleep last night?" → no card; text contains the number.
  3. "how did I sleep and should I train today?" → no card; full text.
  4. No sleep data for last night → no card; truthful text.
- iOS: decoder accept/reject + shared wire fixture, layout tests (fits
  transcript at standard and AX sizes; tap keeps height), Card Studio
  screenshots of each wearable variant and tap state vs Paper.

## Rollout order

1. Merge backend (reader + renderer + producer in one PR; producer emits only
   static `interactive:false`). Deploy Web first (image route for envelope 8),
   then the Cloudflare runner.
2. Rollback floor (ReviewGPT P1, accepted): once any sleep intent is persisted,
   the sleep-capable reader is the runner rollback floor. Sent intents keep
   their card, every read parses through the closed card union, and an old
   reader quarantines them and drops their dedupe projection. Disable or
   revert the producer only by a forward fix that keeps the `sleep_summary`
   reader and text renderer. Draining the queue is not enough.
3. iOS PR with envelope-8 decoding + native view → TestFlight.
4. Native delivery stays off (ReviewGPT P1, accepted). An App Store release
   does not prove recipients updated, and Linq cannot tell which extension is
   installed, so a global flip would show "Murph card unavailable" to anyone
   still on an old extension. Flipping is a separate, explicit owner decision
   after a delivery matrix check (old App Store extension, new extension, no
   extension, macOS). Static delivery shows the complete summary meanwhile.

## Not doing

No wake-up ingestion (WHOOP `disturbance_count` follow-up), no new CLI command,
no env gate plumbing, no scheduler or automatic morning card, no mutable card
store, no per-member capability negotiation.

## ReviewGPT plan review (2026-11-03, lane vonneumann)

Response: `audit-packages/plan-sleep-summary-card.md`.

- P1 exact-date day read misses nights stored on the previous provider date and
  can pass naps/short/tentative sessions: **accepted**; query-owned
  `resolveWearableSleepCardNight` (Authority step 1) with Tokyo boundary,
  zone precedence, nap/short/tentative and total-only tests.
- P1 queue drain is not a rollback floor because sent intents keep cards:
  **accepted**; Rollout 2.
- P1 App Store availability is not recipient compatibility: **accepted**;
  Rollout 4, static stays.
- Note: Apple SDNN is not in the sleep `hrv` field: **accepted** as narrow
  in-resolver enrichment from `hrv-sdnn` points inside the window.
- Reuse `executeResponseCardAttachmentDynamicTool`, `applyResponseCardPatch`,
  the serialization/attachment classifiers and the in-flight steering test:
  **accepted**.
Status: completed
Updated: 2026-11-03
Completed: 2026-11-03

## Completion

- Backend PR cobuildwithus/murph#4518 and iOS PR cobuildwithus/murph-ios#325.
- Four live real-Codex journeys passed (general question attaches the card,
  specific, compound and missing-night questions stay text).
- PR ReviewGPT round 1 on `bcbf8963d18384abdd3f5b7dab5fd308cd42022f`: PASS,
  no findings.
- Deviation from the plan: none in behavior. The static image, text recovery
  and Telegram table label HRV without the method suffix, and the
  no-stage block reads ASLEEP without repeating the total, matching the
  approved native design.
