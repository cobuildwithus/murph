# Invite survives the install

Status: active
Created: 2026-11-12
Updated: 2026-11-12
Review: ReviewGPT architecture review, 2026-11-12, one round (Mountain lane, GPT Pro); findings and outcomes under Review findings

## Goal

A new person taps a friend's one-on-one invite link, installs the app and opens
it to a generic welcome. Nothing ties the invite to them, so they must go back
to the text and tap the link again. Two approved changes:

1. When the challenger picked the friend from Contacts, the invite keeps the
   same hashed lookup key group games already keep. After the new person signs
   in with that number, the app asks once for an open invite addressed to it and
   hands the answer to the path a tapped link already uses. "Leo challenged
   you." appears with no second tap. The welcome screen also gets one line for
   everyone this cannot help: "Friend sent you a link? Tap it again now."
2. The inviter's profile photo shows on the invite inside the app, after
   sign-in only. The public preview, the web page and the link image keep the
   initial.

## Design

### Data stored and its lifetime

- No new table, column, index, migration, flag or config. `game_invitee`
  already has `recipient_lookup_key` with an index on
  `(recipient_lookup_key, game_id)`; one-on-one games leave it empty today.
- On a one-on-one `createGame`, when `inviteeRecipient` is present and the
  invite is not addressed to a known member, store that contact's lookup key on
  seat 1. It is the same keyed blind index (`createHostedLinqParticipantContact`
  `.lookupKey`) group games store. The number itself is still never written.
  Typed-name invites send no recipient and store nothing.
- Cleared when it has done its job or the invite is over: on accept (the same
  update that writes `memberId`), and whenever a one-on-one game goes void
  (called off, blocked, expired) through `endGame`. When someone deletes their
  account, the existing game deletion step also clears any key on an unbound
  one-on-one seat that matches their verified contacts, leaving the invite
  itself untouched. The challenger's deletion needs nothing new: an unbound
  invite has only its challenger, so the game and its invitee row are deleted.
- Known gap, accepted: an invite that runs out and is never read again by
  anyone stays `invited` with its key until the challenger's next Home load
  settles it. No sweep is added for that.

### The lookup

- `GET /api/game/v1/me/invite`, bearer session only. It does not go through
  `canEnterGame`, because until the allowlist is removed a new member with no
  link could not enter; it grants nothing beyond a token the same person could
  use from the text. Returns `{ ok: true, token: string | null }`.
- It reads the member's verified contacts with the existing
  `readGameVerifiedContacts` and `verifiedGameContactKeys`, then one query for
  one-on-one games whose seat 1 has `member_id IS NULL` and a matching key.
  Every cheap exclusion is in that query's `where`, before the limit of five,
  ordered `created_at DESC, id DESC`, so rejected rows cannot crowd out a
  usable one. It returns the first that also passes the final checks.
  Read-only: no write, event, push, settlement or anything the challenger can
  observe.
- In the query, an invite is excluded when: the game is off; it is not
  `invited`; it is past its expiry; its challenger deleted their account; the
  challenger is the caller; the caller is or was a player in it; either has
  blocked the other; or the key matches no currently verified contact of the
  caller. The game switch being off returns none before any read.
- After the query, best effort on stored state: skip an invite whose
  challenger already has a live or negotiating one-on-one game with the
  caller. Accept stays the authority on capacity; the lookup does not settle
  overdue games to find out, so a stale answer ends at the invite's existing
  refusal. Reports do not exclude an invite: a report hides a photo, not a
  person, and the tapped link behaves the same.
- The preview and accept behind the token are unchanged and repeat their own
  checks, so a stale answer only opens the existing "This link isn't
  available" screen.

### Several inviters

The newest open invite wins and is the only one shown. The others stay open and
still work from their own links. Listing them on Home is out of scope.

### The app

- Asked once per sign-in on this phone (the moment a signed-out phone becomes
  signed in), and only when no tapped link is already waiting; a tapped link
  always wins. Not asked on relaunch, so an invite the person closed does not
  come back.
- A token becomes `pendingInvite` through the existing `receiveInvite`, so the
  held-invite header, the pill on the name step, Shake on it and the relaunch
  wait all work unchanged. A 404 or any failure means none.
- Welcome screen: one line under Get started, "Friend sent you a link? Tap it
  again now.", built from the existing welcome text style.

### The photo

- `readInvitePreview` already receives the member id when the request is
  signed in. Only then does the open preview add `inviterAvatarUrl`: a
  short-lived signed link to the inviter's current profile photo, following
  `inviteAlreadyIn` (recheck the invitation, profile and viewer masks before
  signing; null when signed media is off).
- The unauthenticated response is unchanged, so the web page, the link image
  and the app's signed-out welcome keep the initial. Showing the photo before
  sign-up would require putting it in the public response, so it is shown
  after sign-in only: the pill and Shake on it.
- Spec line changes from "Public invite previews never include profile photos"
  to keep that sentence and add that a signed-in member reading an open invite
  gets the inviter's photo.

### Abuse

- Learning whether a number signs up: the challenger sees nothing new. The
  lookup and the preview write nothing, and the invite changes for the
  challenger only when the invitee accepts, as with the link today.
- Unsolicited content: someone who knows a number can make their challenge the
  first thing its owner sees after sign-up. They can already text the link.
  Bounded by: one invite shown, a verified account behind it, the word check,
  7-day expiry, and Block and Report on the invite screen. No new rate limit.
- A recycled number shows the old owner's invite to the new owner for at most
  7 days, the same exposure as the text itself.

### Deploy order and skew

- Server first; every change is additive. App after.
- Older challenger builds already send `inviteeRecipient`, so their invites
  get a key as soon as the server deploys.
- Older invitee builds never call the lookup and ignore `inviterAvatarUrl`:
  today's behaviour.
- New app on today's server: the lookup 404s and reads as none; no
  `inviterAvatarUrl` means the initial.

### Privacy policy

The Games section says a picked contact's number "stays on your iPhone". That
is already inaccurate (it is sent once to check for someone you have played)
and must change to: the number is sent to Murph when you pick a contact; Murph
checks whether it belongs to someone you have played, does not store the
number, and keeps a hashed lookup value of it with the invite so the invite
can be shown to that person if they sign in with the same number; the value is
removed when the invite is accepted or ends. "From other Murph users" gains
that an invite may be matched to you by a hashed value of the number the
sender picked. Text only; whether to publish it as a new policy version (which
re-asks every player) is the owner's call and is not done here.

### What can be deleted

Little. No code path becomes dead: the tapped link stays the backstop. The
stale comment in the app that describes a deferred deep link the page never
kept is corrected. The spec's "then the invitee taps the same link again" is
narrowed to the cases that still need it.

## Scope

- In scope: server store, lookup route, authenticated preview photo, policy
  text, spec; app lookup call, welcome line, photo on the pill and Shake on it.
- Out of scope: typed-name invites, email sign-ups, Home listing, clipboard,
  web page and link image changes, group games.

## Tasks

1. Server (delegated): store and clear the key, lookup route, preview photo,
   tests, policy and spec text.
2. App: wire field, lookup at sign-in, welcome line, photo, tests, screenshots.
3. PRs in both repos, each naming the other and the overlap with the allowlist
   removal and the App Review fixes.

## Decisions

- Expiry is filtered in the lookup query for normal clocks; rows with a dev
  clock offset are checked after it, since SQL cannot apply a per-row offset.
- The photo is a signed link checked in its own small helper next to the
  preview, following `inviteAlreadyIn`; media route access is unchanged.
- After the allowlist was removed on `main`, the lookup route uses the same
  `requireGameMember` guard as every other game route instead of its own
  bearer check; with the switch off it answers `GAME_DISABLED`, which the app
  reads as no invite.
- The policy text changes without a new policy version or regenerated PDFs.
  Publishing a version re-asks every player, which is the owner's call.

## Review findings

One ReviewGPT round on the written plan before any server code. Two findings,
both P2, plus notes.

1. Account deletion does not cover a contact-only seat; the planned
   challenger-deletion cleanup is redundant. **Accepted.** Verified:
   `applyGameAccountDeletionTx` only matches `memberId`, and an unbound invite
   whose only participant is the deleted challenger is deleted with its row.
   The plan now clears matching keys in the existing deletion step and drops
   the challenger branch. A matching key does not count as participation.
2. Filtering after taking five candidates lets rejected rows hide a usable
   invite. **Accepted.** Exclusions moved into the query before the limit,
   with a deterministic order.
   - Reports are not blocks. **Accepted**: reports no longer exclude.
   - Pair capacity cannot be checked read-only with full parity. **Accepted**:
     a stored-state check only, accept stays the authority.
3. Rollback floor: deploy the clearing code before the code that writes keys.
   **Rejected.** After a rollback the worst case is a key left on an accepted
   or ended one-on-one row, which the lookup never reads (it needs `invited`
   and an unbound seat) and which is the state every group game row is in
   today. A two-step release to prevent that adds process for no behaviour.
4. Keep discovery separate from acceptance, the bearer-only route, and the
   photo on the authenticated preview only. **No change needed.**
5. App cases the server snapshot could not show (restore is not a sign-in, a
   tapped link wins mid-lookup, an old session's answer is dropped, the
   preview is read again signed in, 404 means none). **Accepted as app test
   requirements.**

## Verification

- Server: focused game service and route tests, workspace typecheck.
- App: lint, both schemes build, changed test classes once, evidence captures
  on a private simulator.
