# Scheduled Card Send Intent

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Ensure an exact scheduled notification that successfully attaches a supported
response card reaches the existing outbox even when the model does not also
return the redundant structured `send_message` envelope.

## Evidence

- Production metadata showed one scheduled closeout occurrence repeatedly
  complete `murph.attach_response_card` successfully while creating no delivery
  intent, then exhaust the existing cron backoff and expire.
- `assistant-codex` already makes the attached card the authoritative final
  response and renders its deterministic delivery and transcript text.
- `notification-turn` reparses the superseded model-authored response and
  rejects runtime-owned presentation unless that response independently says
  `send_message`.
- Prompt guidance describes a complete card as the response, while the
  notification adapter still requires non-empty companion text. Existing tests
  provide that companion envelope synthetically and do not cover card-only
  provider completion.

## Ownership Boundary

Keep `notification-turn` as the single scheduled delivery decision owner.
When the provider result contains runtime-owned final presentation, derive the
send decision from that existing presentation. Preserve a valid model-authored
send decision only for its internal summary or optional email subject; never
allow invalid or skip-shaped superseded text to veto an already attached card
or deterministic card recovery.

## Product UX Patch

- Outcome: A completed scheduled card reaches the member instead of retrying
  and expiring because a redundant companion decision is absent.
- Reaches: Existing private scheduled-card delivery through Linq, Telegram,
  and email, plus already-authorized Linq challenge standings and Telegram
  routine or rich-content group cards. No new audience, timing, permission, or
  product meaning is introduced.
- Proof: The notification runtime regression exercises the card-only Linq path
  through delivery and transcript persistence, while the supported-channel
  matrix covers fitting cards and complete text recovery.

Walkthrough result: `Ready`. A private Linq automatic meal closeout with a
finished card now reaches the existing destination and persists the rendered
transcript. Authenticated Linq and Telegram group routes deliver only their
currently supported card kinds through the same owner, while existing outbox
validation rejects unsupported audience or channel combinations. Linq,
Telegram, and email also deliver the existing complete text fallback when a
rich card cannot fit. Ordinary model-owned send-or-skip notifications remain
on their strict parser path. No visual proof is needed because presentation is
unchanged.

## Tasks

1. Add a focused scheduled fitting-card regression with no model-authored
   companion envelope.
2. Replace the redundant strict decision check with one small resolver at the
   notification boundary.
3. Update the existing cardless-overflow regression to prove runtime-owned
   recovery reaches delivery rather than retrying the occurrence.
4. Run focused notification tests, assistant-engine typecheck, diff hygiene,
   Product UX walkthrough, and the required PR review gates.
5. Prove the same runtime-owned card rule for every currently supported
   authenticated group card route and retain the existing negative audience
   validation proof.

## Constraints

- Add no state, queue, retry path, schema, feature flag, or compatibility shim.
- Preserve ordinary send-or-skip parsing when the model still owns final
  presentation.
- Preserve valid model-authored `privateSummary` and email `subject` fields.
- Keep runtime-rendered card and recovery text authoritative for delivery and
  transcript persistence.
- Use synthetic fixtures only; do not retain production content or identifiers.

## Verification

- Focused `assistant-notification-turn-runtime` scenarios for fitting cards,
  card-only completion, and cardless overflow across supported channels.
- `@murphai/assistant-engine` typecheck.
- `git diff --check` and privacy-safe final diff inspection.
