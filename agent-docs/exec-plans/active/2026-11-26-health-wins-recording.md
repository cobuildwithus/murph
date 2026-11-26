# Recording activities for Health wins

## Outcome and ownership

A member with recording enabled can preview a timed session, save its summary privately,
or post chosen cards to the existing game-partner audience. The phone owns the recording.
Web validates the submitted data, builds the exact cards the member can share, and stores
the summary under the member's key. Settings exports the member's saved summaries, including
after health-consent withdrawal. Deleting the account removes the rows.

This plan spans the server and companion rollouts. The first Web change delivers timed cards,
the recording capability, storage and export.
GPS capture, map rendering, splits and painting have separate rollout gates.

## Product decisions

- A partner can scrub the minute averages on a published heart-rate card. Choosing
  **Hide my numbers** removes the series and numeric labels before the card is sealed.
- For future route cards, offer a painting keyed only by a public map tile area behind
  `MURPH_HEALTH_PAINTED_RUNS`. Start with owner evaluation. Use Apple's muted map
  during recording and as the fallback when art is unavailable.
- Trim a fixed 200 metres at each route end. The phone can also exclude a private
  region with a radius of 200, 400 or 800 metres.
- Saving keeps a sealed summary on the server for session wins. The phone keeps the
  reduced display data for seven days so the member can publish during that window.
- Keep the existing single-photo attachment. Suggest an editable title from the kind,
  local time bucket and same-day activity history. Place lookup is unnecessary.
- A recording is independent of game check-ins. A future run's **Hide my numbers**
  removes numerical chips, heart rate and splits. **Hide the map** removes the route card.
- Apple Watch members can record time and see the option to connect a supported sensor.
  The first release caps recordings at six hours, with Apple Health writes and Lock
  Screen Live Activities outside its scope.

## Accepted design review

1. **Accepted.** The phone owns the final route privacy transform. Trim both ends by
   the full distance. After simplification, rounding and capping, check every segment
   against the private zone. Offer the remaining cards when the path disappears.
   Removing a map also removes its frame and area key. Server bounds check plausibility.
2. **Accepted.** Reconcile recorded sessions with wearable candidates through the query
   package's existing activity aliases, duplicate identities, mirrors and overlap rules.
   Retain the evidence those rules require before reducing a session to a date and minutes.
3. **Accepted.** Validate minute averages against the physiological limits and the
   summary envelope. A sample-level peak can exceed every minute average. Derive chart
   markers from the displayed series and identify the peak used in the subtitle.
4. **Accepted.** Fingerprint the final rendered spec after applying the option and
   display units. A committed retry uses its existing receipt. Future splits carry
   distance and seconds with an explicit partial final split.
5. **Accepted.** The phone journal tracks recording, paused, finished and saved states.
   Compact saved drafts atomically, expire after seven days and remove on publication
   or discard. Persist publish intent and post ID before the first network attempt.
6. **Accepted.** Future painting jobs must recheck the member, consent, originating
   post and selected route card immediately before contacting a provider. The map
   fallback keeps publication independent of art.
7. **Accepted.** Include saved summaries in the actual Settings download through
   `loadBrowserVaultExport` and the vault-export API. Preserve the member's export
   right after health consent is withdrawn. Account data service owns deletion coverage.

## Delivery and proof

1. Document the permitted display data and classify each database column.
2. Deploy the additive table and compatible Web reader/writer before enabling timed
   recording. Preview stays stateless. On post, rebuild the chosen variant, check its
   revision, then bind the activity and post atomically. Allow caption edits and card
   removal on a published recording. Keep raw samples and untrimmed fixes on the device.
3. Verify plain time, sensor gaps, hidden numbers, changed previews, retries, concurrent
   binding, mixed card order, edits, disabled capabilities, audience, export and deletion.
   Pre-recording clients can read frozen titles and subtitles. New clients need the
   capability before issuing writes. Keep the export-capable server as the rollback
   floor while recordings exist.
4. Deliver the companion recorder, protected draft recovery and timed composer separately.
   Reuse the query-owned session reconciliation for saved summaries. Introduce the GPS
   capability only after server route validation and the client's privacy transform are
   ready. Enable public-area painting last, following owner review.

## Session counting handoff

The current Browser Vault projects wearable sessions to local date, type and minutes
after reconciling provider identities and overlapping intervals. Web cannot reproduce
that decision from those three fields. Row 4 therefore owns counting recordings in
session wins. It needs a compatible projection with reconciliation inputs, a bounded
summary read, shared activity aliases and candidate-set cache invalidation. The timed
server rollout can save and export summaries independently.

## Web handoff

Local PostgreSQL verification covered preview without writes, concurrent saves and
competing publications, mixed selections, stale revisions, post removal, partner access
and consent withdrawal. The Settings client and route exported multiple pages of summaries
for a withdrawn member without a retained vault replica. The activity migration applied
to a fresh database and account deletion removed its saved rows. The focused Web suites,
typecheck and Prisma validation passed. The companion rollout and session projection
work remain open.
