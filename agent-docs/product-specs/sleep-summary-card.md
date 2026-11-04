# Sleep summary card

A general nightly summary request in a private direct conversation returns one
host-built `sleep_summary` card and no final prose. Single-metric questions get
a verified number in text. Compound questions and advice requests remain text.
The `sleep-improvement` skill and `murph.attach_sleep_card({ date })` own routing;
the date is the local wake date. Missing eligible data returns
`no_sleep_for_date`, followed by an honest text reply, never a fabricated card.

## Canonical read and mapping

`@murphai/query.resolveWearableSleepCardNight` reads the requested stored date
and its adjacent dates, then selects by localized sleep end. A validated night
zone takes precedence over canonical vault reporting timezone. Without a zone
or window, the stored date remains usable and wall-clock times stay null.
Explicit naps, short sleep and tentative sessions are excluded. Unknown
classification and total-only evidence remain eligible. Main sleep wins first,
then the largest total, latest end and stable stored-date tie break. Existing
`wearables day` selection is unchanged.

Resting HR comes from recovery on the local wake date, preferring the selected
night's provider (or the total's provider for a night without a window). Only
when that provider has no resting HR does the card use the cross-provider
selection for the same wake date. Resting HR never means average or lowest sleeping HR. Sleep HRV is
RMSSD; absent sleep HRV may use the mean of canonical `hrv-sdnn` points inside
that night's valid window. The read is bounded to adjacent dates and 10,000
points; saturation omits enrichment. A date-wide or daytime HRV mean is not a
substitute. The presentation preserves the HRV method in text and Telegram.

The host rounds integers before validation. Stages require all three values and
a positive bounded sum; all-zero stages become null. Awake time and efficiency
of zero become null. Efficiency fractions are converted to percent. Score is
provider sleep score, or WHOOP sleep performance when score is absent. No
score is synthesized. Wake-ups always remain null until an importer owns them.
Awake minutes are not awakening counts. Consumer stages remain less reliable
than timing and total sleep.

## Immutable wire and audience

`packages/contracts/src/sleep-summary-card.ts` owns the strict V1 schema,
formatting and envelope 8. Envelope 7 remains reserved for wearable trends.
The exact envelope keys are `schemaVersion`, then `card`. Every card field is
present, with unavailable fields set to null, in this order:

`kind`, `version`, `localDate`, `bedtime`, `wakeTime`, `totalSleepMinutes`,
`score`, `stages`, `awakeMinutes`, `efficiencyPercent`, `hrv`,
`restingHeartRate`, `wakeUps`.

Nested stage and HRV objects are strict too. The encoder parses before
serialization so construction order cannot change the shared Swift fixture.
The card contains no identity, provider, source reference or canonical record
identifier. Both the fragment and queryless image path are bounded below 2,048
characters. Encoding does not encrypt the presentation values.

Only private-direct card availability permits the tool, including existing
explicit scheduled-card exceptions. There is no group exception or new
scheduler. Execution reuses the existing audience, one-card, media conflict,
current-delivery and in-flight steering protections and response-card patch.
The outbox, receipts, dedupe identity and deterministic text recovery stay with
the existing delivery owner.

## Presentation and release

Linq sends sleep interactively only when the per-invocation
`MURPH_NATIVE_SLEEP_CARD_ENABLED` flag is exactly `1`. The Worker derives it
from exact, trimmed membership in `MURPH_NATIVE_SLEEP_CARD_MEMBER_IDS`; the
comma-separated allowlist never enters a runner or job payload. Only members
with a compatible TestFlight extension should be allowlisted. Everyone else
receives the static bitmap, including old installed extensions and macOS. Other
card kinds retain their existing interactive delivery. The caption is a short wake date, such as `Tue, Nov 3`, with no subcaption; the
notification fallback is value-free: `Your sleep summary.` Telegram uses one
rich message with date, image and a table containing only present values.

The Web image is 1200px wide, matching a 320pt card at 3.75x. It uses the shared
Messages fonts and chrome, leaves the native badge footprint empty, and shows
total sleep, an optional score ring, proportional stages (or one ASLEEP block),
optional local times and present metrics. Height depends only on optional rows.
The provider owns the outer mask. The route rejects malformed and query-bearing
payloads before font reads, has no database or remote reads or application logs,
and responds with private no-store and noindex headers.

Deploy Web before the runner. Once any sleep intent is persisted, the
sleep-capable reader and text renderer are the runner rollback floor, including
already-sent intents. Queue draining is insufficient. Disable production only
with a forward fix that preserves those readers. The native allowlist changes
no Web reader, persisted format, or protocol.
Old Worker/new runner has no flag; new Worker/old runner ignores it. Both send
static sleep cards. Reverting this gate returns to static delivery while retaining
the existing sleep readers. Broad native delivery still requires an owner
decision and old/new-extension, no-extension, and macOS compatibility checks.
An App Store release alone does not prove recipient compatibility.

## Proof

- Contracts: strict keys, integer bounds, nullable pairs and envelope 8.
- Query/builder: synthetic Oura, WHOOP, Apple Watch SDNN, phone totals, Garmin,
  zero stages, missing nights, Tokyo boundaries and reporting-zone fallback.
- Operator: exact Swift fragment fixtures, value-free fallback, date-only
  chrome, text/transcript/Telegram and static-by-default Linq sleep delivery.
- Web: real PNGs, sparse/narrow states, pre-font rejection and emitted runtime.
- Assistant: selector schema, availability, audience/conflicts, current input,
  and four focused real-Codex summary, metric, compound and missing-night cases.

The repository-owned visual study is
`https://www.withmurph.ai/design?tab=components#imessage-sleep-card` after deploy.
It renders the production component with synthetic complete, Apple Watch and
sparse specimens. Local PNG proof establishes presentation, not handset delivery.
