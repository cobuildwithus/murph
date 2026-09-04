# Reallocate stopped member standby slots

Status: completed
Created: 2026-09-03

## Outcome

- Reuse a claimed standby container while it is still warm for the same member.
- After that container has stopped, retire its one-way member binding, clear the
  existing `UserRunner` stop target, and let the same foreground request claim
  the current ready standby slot.
- Keep standby allocation member-scoped; conversations and group chats do not
  become lifecycle or ownership authorities.

## Protected invariants

- A claimed standby slot is never rebound or returned to the shared ready pool.
- Wrong-member, stale-release, ambiguous cleanup, and unsettled container state
  remain fail-closed and cannot create two live containers for one invocation.
- Only trusted foreground default processing may claim a fresh standby.
- The correction adds no scheduler, queue, callback, persisted field, or
  lifecycle owner.

## Product UX

- Effort: Patch.
- Outcome: An existing member's next message does not pay a cold restore on a
  stopped container when a ready standby is available.
- Reaches: Existing private and group conversation starts that already qualify
  for standby allocation; audiences, permissions, and reply destinations do
  not change.
- Proof: Exercise repeated warm reuse, post-idle retirement followed by a fresh
  claim, and fail-closed wrong-member or ambiguous-liveness recovery.

Walkthrough result: Ready. For both private and group messages, the same member
keeps the warm target while it is live. After idle stop, the old target retires
and the same foreground request can claim one replacement before normal reply
processing. Unknown status or mismatched ownership still yields for retry and
cannot start a second container. The existing message content, audience,
delivery, and error presentation are unchanged.

## Proven gap

- Successful completion deliberately preserves a standby slot name as the
  member's pending runner target.
- Bound standby idle cleanup stops the native container but does not retire the
  binding or clear that pending target.
- Retained-target resolution validates member, release, and slot identity but
  does not validate native-container liveness before returning `retained`.
- Production evidence showed a retained allocation followed by a cold restore,
  so the stale target bypassed a fresh ready-slot claim on a foreground message.

## Smallest correction

1. Ask ReviewGPT for a scoped patch that derives reusable-versus-stopped state
   at the existing standby-slot owner and reuses the current retirement and
   `UserRunner` clear/claim sequence.
2. Integrate only the smallest race-safe patch; reject new state machines,
   background cleanup, callbacks, or duplicated lifecycle truth.
3. Add focused proof for warm retained reuse, stopped-slot retirement followed
   by a fresh claim, wrong-member failure, and unsettled-state retry.
4. Update the live standby contract docs, run focused tests and the Cloudflare
   package typecheck/build, then complete the PR and final ReviewGPT gates.

## Deployment concerns

- The change is confined to the Cloudflare Worker and its container Durable
  Objects. Deploy it as one Cloudflare release so the Worker RPC caller and
  standby container class agree on any changed method surface.
- Existing bound slots must converge safely: live ones remain reusable, stopped
  ones retire on their next eligible foreground start, and release-mismatched
  slots keep the existing cleanup path.
- Post-deploy proof should observe a warm continuation as `retained` and a
  post-idle continuation as a retired old target followed by `claimed`, without
  duplicate active fences or wrong-member admission.

## Implementation record

- ReviewGPT Pro returned `cloudflare-standby-warm-retirement.patch` with SHA-256
  `843a43e80f448fa993a9bc9d6c8f10fc3a81f7381b7d4fb3852b1084d62a27d3`.
  The patch authenticated and applied, but its parallel retained-result DTO and
  generated test expansion were collapsed before landing.
- The final design adds one lifecycle-locked native warmth proof to the existing
  container owner. The standby Durable Object validates member/release/slot,
  returns the existing binding type, and owns the existing retirement path.
  `UserRunner` only clears a proven-retired exact target and then follows its
  unchanged fresh-claim rules.
- No persisted schema, background owner, scheduler, queue, callback, or
  conversation-scoped authority was added.

## Verification record

- Focused standby, identity, write-fence, and alarm proof: 4 files, 225 tests
  passed.
- Cloudflare package typecheck and build passed.
- Cyclomatic-complexity diff passed with no new hotspot or debt.
- Agent-doc drift and gardening passed with zero issues.
- Full Cloudflare verification passed: 154 Node test files (2,843 passed, 2
  skipped), 1 container-helper file (6 passed), and 6 Worker test files (15
  passed).
- The production changelog entry passed the focused archive render test (1
  file, 9 tests).
Updated: 2026-09-03
Completed: 2026-09-03
