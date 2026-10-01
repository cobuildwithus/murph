# Media retention correctness at existing owners

The user resumed final review findings and prioritizes simple, maintainable,
composable architecture. Preserve both image/video externalization and on-demand
reads; fix the three demonstrated data-loss paths without new services.

The prior continuation stopped at its usage limit before editing. Its launcher
and child session are inactive; local and pushed head match f0fc35a3e563 and the
tree is clean. This session resumes exclusive branch ownership for PR #2874.

## Accepted findings and approach

- Durable captures: reuse core's generated-image provenance predicate. Ordinary
  canonical captures have no transient TTL while their live holder exists.
- Crash recovery: carry the external media identity in its existing raw write
  receipt; replay the reference in assistant-runtime without reading media.
  Core owns the receipt contract; runtime owns catalogue reconstruction.
- Save/expiry race: atomically claim retirement in the existing SQL row before
  asynchronous R2 deletion. Preserve terminal identity and pending deletion
  evidence; registration cannot acknowledge preservation after retirement.
  No additional queue, service, lock manager, or independent lifecycle index.

## Product proof

Saved captures remain readable beyond transient TTL, including migration of
older saves. New media acknowledged before a snapshot survives process loss.
Saving against expiry has one ordered outcome and never acknowledges missing
bytes. Expiry still runs without waking or decrypting the workspace.

- [x] Reproduce each finding through the owning boundaries.
- [x] Implement the minimal corrections and inspect failure ordering.
- [x] Run affected tests/typechecks and scoped architecture/complexity checks.
- [ ] Refresh exact PR evidence, review on the next head alongside CI, merge
      after gates, and retire the worktree.

First-reviewed head remains c51e3638aa2e8f353a6c332e7921b71755b1580a.
Round 2 at f0fc35a3e56375d4235f10418f4275b6c8aa3204 returned three accepted
High findings. The response and model verification are retained in ignored
audit artifacts. The next substantive review is round 3, a full sensitive audit.

## Implementation evidence

- Ordinary captures recorded before the transient lifetime survive publication
  and selected retrieval. Generated captures reuse the core provenance rule.
- Real canonical capture receipts replay into a vault predating the capture,
  without media reads; repeated replay is idempotent and selected retrieval
  returns the original bytes. Expired local caches cannot bypass the deadline.
- Barrier-controlled alarm/read expiry races prove that preservation either
  wins before retirement or is rejected. Failed deletes retry; late uploads
  keep the terminal row and re-arm purge without resurrecting the identity.
- Previous-head CI also exposed a missing guarded-replacement preimage fetch
  and premature visibility of newly steered video authority. Restore now fetches
  only guarded replacement targets when replay needs them. Initial historical
  video authority stays frozen; new clips retain the provider acceptance gate.
- Focused Cloudflare schema/alarm/outbound/restore tests, runtime artifact and
  retention/restore tests, core receipt tests, and assistant video/concurrency
  tests pass. Core, runtime, engine and Cloudflare typechecks pass; complexity,
  documentation drift and workspace-boundary guards pass.
- The focused retained-video real-Codex journey passes with gpt-5.6-terra and
  local subscription auth after pre-action quota failures on earlier profiles.
  First turn acknowledges with zero materialization; the second turn restores
  the removed local clip once, analyzes once, and answers the synthetic visual
  question correctly. Reply review: Ready.
- Implementation is complete. Final exact-head review and required GitHub
  checks remain merge gates; this archive does not claim their completion.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
