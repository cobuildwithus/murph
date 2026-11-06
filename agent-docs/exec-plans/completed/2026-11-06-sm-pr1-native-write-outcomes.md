# Preserve native admission proof and write outcomes

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- A native game write or Messages member action admitted before logout cannot
  commit after it.
- A genuine server failure never makes an installed app delete an unsent shot
  or reply.
- A delayed post can no longer replace a post another device already made,
  once the app asks for that guard.

## Success criteria

- Revocation between admission and commit returns the native unauthenticated
  error and writes nothing, on every member write branch.
- Real route bytes for server failures decode as retained under the pinned iOS
  rules, for shots and replies. Malformed input and rule refusals stay final.
- A guarded post on an occupied slot leaves the entry, its reply and the retake
  untouched. Same-ID replay and an omitted field behave as before.

## Scope

- In scope: game command boundary, the four write branches that skipped the
  session hook, game media failure classification, the Messages member-action
  route, and the optional post field.
- Out of scope: the shared JSON renderer, read routes, the iOS emitter (a later
  app change), and the board sharing route, which has its own transaction and
  was not part of the reviewed findings.

## Constraints

- Technical constraints: member lock stays before game and pair locks. External
  work stays outside transactions. No schema change.
- Product/process constraints: Web deploys first. Old clients omit the new field.
  The guard is an empty-slot check, not a day check, because a capture's opening
  day is not its posting day.

## Risks and mitigations

1. Risk: a raw error after the body read that really was client input now looks
   retryable.
   Mitigation: `parseGameCommand` and `moderateGameCommand` validate first and
   throw rule errors, and foreign keys are refused before any storage call. The
   failure direction keeps the member's content.
2. Risk: an extra member and session lock on each native write.
   Mitigation: same order as account deletion and push registration, and the
   queries are bounded and short.

## Tasks

1. Keep the session proof through `respondToGameCommand` and all write branches.
2. Add the exact-row check to the Messages append.
3. Classify failures by position at the write boundary and at the media source.
4. Add the optional empty-slot expectation.
5. Prove each at the real boundary and update the owner docs.

## Decisions

- Failures are classified by position, not error class: everything past the body
  read is ours. The shared renderer stays unchanged.
- The Worker's own 400 and 413 on image staging stay final, because a retry would
  send the same bytes.
- The refusal is a new code, `SLOT_TAKEN`, so the app can tell it from a closed day.

## Verification

- Commands to run: focused Vitest for `game-api-postgres`, `game-replies-postgres`,
  `game-routes`, `game-media`, `game-push-route`, `imessage-mini-app-*`, typecheck,
  `pnpm complexity:diff`.
- Expected outcomes: all pass. Removing a session hook makes the matching
  revocation test fail. Real route bytes run through the pinned Swift decoder
  retire only final refusals.
Completed: 2026-11-06
