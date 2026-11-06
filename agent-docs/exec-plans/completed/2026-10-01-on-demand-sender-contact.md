# Read private sender contact only when needed

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Outcome and invariants

Private iMessage sender handles remain available when a request needs them,
without being repeated in ordinary model inputs. Scheduled calls still save an
explicit approved number. Group attribution and existing call authority remain
unchanged. No seen-once state, cache, network lookup, database query or new port.

## Ownership and evidence

The canonical accepted input already retains the authenticated Linq sender.
The prompt renderer currently unconditionally presents that metadata. Existing
contact tools assign Murph lines or inspect group membership; neither represents
the private incoming sender. A small deferred read reuses the current accepted
input scope and input-event reader, with no model-selected identity or path.

## Tasks

1. Suppress private Linq sender presentation and add one deferred contact read.
2. Teach the phone skill to resolve unknown self-contact on demand before saving.
3. Prove current private scope, unknown/email handles, group/scheduled denial,
   retirement and legacy compatibility, prompt token reduction and group parity.
4. Rerun the three synthetic live call journeys through the production tool.
5. Review, focused tests/typecheck, PR, ReviewGPT, required CI, merge.

## Product UX

Outcome: Request a future call without repeating a known phone number.
Reaches: Private Linq phone/email/missing sender; group attribution; due turns.
Proof: No sender handle in private prompt, one lookup only when needed, one save,
no immediate call, one due attempt, honest missing-number and uncertain-start replies.
Done when: All selected journeys are Ready and existing scheduling stays intact.

## Deployment and failure

Keep the existing persisted sender format and replay compatibility. Engine tool
and skill ship together; old runtimes can continue the previous prompt behavior.
A missing or ineligible current input returns unavailable; no fallback scan or
provider call. Existing scheduled instructions already contain their number.

## Verification

Focused engine tests, engine typecheck, complexity guard, complete first-provider
input measurement for private/group fixtures, and real Codex known-number,
email-handle and uncertain-start journeys. Required exact-head CI owns broad proof.

## Candidate result

Product UX: Ready. Parent review confirmed the existing accepted input is the
sole contact owner; private prompts omit both current and legacy sender labels,
and group attribution remains intact. No additional architecture is needed.

- 211 focused tests passed across contact dispatch, prompt rendering, turn
  availability and existing phone-call behavior; engine typecheck passed.
- Complexity guard passed: dispatch 138 to 136, communication planning 26 to 24;
  new contact executor 20. Remaining existing hotspots are unchanged.
- Complete first provider input: private 145098 to 145074 bytes (-24), group
  132011 to 132011 bytes. Deferred lookup does not enter the first request.
  Exact model tokenizer unavailable; no token estimate is claimed.
- Three real Codex journeys passed: one current-contact lookup and saved future
  call, email sender asks for a phone without saving, and uncertain due start
  reports uncertainty without retrying. Telephone provider effects are synthetic.
- Changelog not applicable: internal contact-delivery optimization preserves
  the existing member-visible scheduled-call behavior.

PR ReviewGPT and required CI are the remaining publication gates, tracked in
the PR evidence; this plan records the completed candidate implementation.
Completed: 2026-10-01
