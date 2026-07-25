# Group-chat social dynamics: floor ownership, handoff, and adaptive presence

## Problem

Murph is over-eager in group chats. The observed failure: a member posted a
photo and addressed Murph, Murph answered, a second member then replied
directly to the first member with their own joke, and Murph appended an
institutional one-liner on top of it.

Nothing in the shipped policy prevented that, and one part of it authorized it:

1. The `group-chat` decision ladder protected only "a question was addressed to
   a specific human." The offending message was a comment and joke aimed at
   another member, not a question, so that rule did not match. The ladder is
   first-match, so the banter rule matched before the two-people-in-their-own-
   exchange rule further down could ever be reached.
2. `groupchat-comedy` framed Murph as "the referee of a group health challenge"
   with humor as "the retention engine," and it was routed on essentially every
   banter turn. That framing is right inside a challenge and wrong for ambient
   conversation. The institutional-reframe format (integrity review, stewards'
   inquiry) became a reflex rather than a format.
3. The two skills conflicted on recovery. `group-chat` said comply without
   ceremony when told to chill; `groupchat-comedy` said perform a visible
   sheepish retreat and make the apology itself a bit. When the complaint is
   that Murph spoke at all, another Murph line is the wrong recovery.
4. Nothing in the prompt explained *why* group-chat Murph works, so the model
   had etiquette rules without the causal model that generates them.

## Change (prompt and docs only; no runtime, schema, or tool changes)

### A. New product spec

`agent-docs/product-specs/group-chat-social-dynamics.md` holds the long-form
theory for humans: the social mechanism, the three floor shapes, room
relationship phases, participation boundaries, reply selection, memory and canon
rules, failure modes, and evaluation cases. It is not resident prompt text.

### B. One compact invariant in the static group core

`buildAssistantGroupIdentityAndScopeText` gains a `Social role:` block: humans
are the protagonists; Murph is an active, low-ego participant and not a passive
help desk; neither a funny line nor a blanket preference for silence overrides
the actual conversational floor. This survives a missed skill read.

### C. `group-chat` owns the floor

- New "The social mechanism" section: social alibi, shared third object,
  reversible vulnerability, guaranteed acknowledgment, replyability, canon.
  Framed as a social model to read behavior against, not a license to
  psychoanalyze the room.
- New reply-selection rule: prefer the line that gives the human more stage and
  the room more handles. Make the person more interesting, not Murph more
  impressive. Judge a turn by what the humans did next, not by what Murph got
  back.
- New "Room relationship and tapering" section: arrival, resident, and
  self-sustaining, inferred from behavior with no day count, phase flag, or
  timer. Resident presence is selective, not rare.
- Ladder reordered around floor ownership: participation boundary, then
  human-owned turn, then Murph addressed, then open room request, then open
  ensemble banter, then uncertainty. "A question was addressed to a specific
  human" widens to any message a specific human owns.
- The handoff is beat-local: do not tag a human-owned punchline, but a later
  open beat, callback, ruling, or renewed focus on Murph can earn another line.

### D. `groupchat-comedy` becomes subordinate

New "Turn authority" section: `group-chat` owns the floor; this skill shapes an
already-permitted turn and never requires direct address. Referee framing is
scoped to an active challenge. The institutional frame is a format, not a
reflex. The second beat lives inside the same earned message. Silence, not a
sung apology, is the response to "wasn't talking to you." Canon must create
recognition, not entrapment.

## Verification

- `pnpm test:diff` over the changed paths.
- Skill-text regressions in `assistant-group-chat-style-skill.test.ts` and
  `assistant-groupchat-comedy-skill.test.ts`; static-core coverage in
  `model-behavior.test.ts`.

## Known gap

The added tests prove the sentences exist, not that the model applies them.
Cases 11 through 13 in the spec's evaluation list (closed-performance versus
stage-giving reply, reinforced versus one-off callback, no-reaction reply that
started a human exchange) are judgment calls that need transcript-level model
evals. Not in this change.
