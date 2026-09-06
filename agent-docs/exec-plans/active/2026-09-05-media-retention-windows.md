# Extend conversational media retention

## Outcome and contract

Retain newly published inbox images for 90 days and videos for 30 days,
including same-conversation discovery and selected access throughout those
windows. Audio and ordinary message/transcript content keep 14 days. Existing
media-store references keep their earlier recorded deadlines; expired objects
cannot be revived. Explicit durable saves keep their canonical holder lifecycle.

Use the existing encrypted owner-scoped R2 media store, reference ledger,
materializer, assistant input records, and frozen turn authority. No new durable
store or index. Retired input records preserve attachment identity and trusted
conversation metadata, while text, transcripts, derived fragments, and quotes
are cleared. Late attachment projection cannot restore retired text. Residue
cleanup preserves records with live image/video references.

## Product UX

Product change. Private and authenticated group requests can list up to 20 dated
attachments per page. A selected image loads through the existing integrity
resolver for native viewing; a selected video uses the existing analyzer.
Listing alone makes no byte-availability claim. Missing or expired selections
provide reselection or resend recovery. Cross-conversation and unverified-group
access remain denied. Scheduled work receives no new tool authority.

## Investigation

Merged PR #2874 fixes separate byte retention and same-conversation historical
video authority. Earlier hosted cleanup used zero-duration video retention and
excluded those bytes from snapshots. The reported unavailable-message error
also preceded byte loading because historical selection lacked authority.
This change extends the merged implementation's 14-day image and 3-day video
windows and resolves the separate 14-day attachment-reference cleanup limit.
No private production conversation was replayed and no production mutation ran.

## Verification

- 220 focused assistant tests passed across input storage, video analysis,
  residue cleanup, turn planning, and composed attachment access. After shared
  authorization simplification, all 180 affected tests passed again.
- 30 inbox-retention tests and 57 runtime artifact/idle tests passed, including
  exact 14/30/90-day boundaries, selected cold loading, cached expiry, saved
  media, terminal retirement, legacy deadlines, and parser protection.
- Assistant-engine, inboxd, and assistant-runtime typechecks passed.
- Live local-subscription gpt-5.6-terra video journey passed: fresh second
  session without earlier text or local bytes, discovery, one materialization,
  one analysis, correct concise reply, no resend request.
- Live image journey passed: dated discovery, one selected materialization,
  and correct visual answer. Native image-view assertion is being finalized.
- Complexity guard passed with no debt growth; dispatcher debt decreased by 4.
- Full native first-request captures compare identical synthetic direct/group
  fixtures with the merged tool catalog versus the added attachment tool.
  Token/byte measurements and transport-field exclusions are recorded in PR
  evidence; private data and auth are excluded.

## Remaining completion

- [x] Implement full-window storage and lookup with recoverable selection.
- [x] Review source ownership, privacy, and focused behavior.
- [ ] Finalize changelog provenance, rendered proof, and remaining typechecks.
- [ ] Commit the candidate, open a draft PR, and run routed external review/CI.
- [ ] Close this plan and report exact completion state and rollout limits.

## Rollout

Schema remains compatible with merged #2874 (media retirement floor v19).
Deploy the updated runner bundle before relying on the longer lookup contract;
old warm runners can still clear references or shorten lifetimes. No migration
or backfill extends existing deadlines. Rollback may shorten availability but
must stay above #2874's retirement ordering floor. Verify cold-restored image
and video follow-ups after runner convergence.
