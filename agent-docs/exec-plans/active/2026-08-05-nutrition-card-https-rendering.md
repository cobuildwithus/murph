# Nutrition card HTTPS rendering correction

Status: active
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make daily nutrition response cards render visibly in iMessage through Linq's
  documented static app-card contract.
- Preserve the existing single outbox effect, deterministic text fallback, and
  partial-total semantics without adding another state or rendering owner.

## Root-cause proof

- The response-card tool completed and the outbox retained one card-bearing
  delivery intent.
- Linq accepted the request and later reported a delivered iMessage, but the
  physical transcript did not show the card.
- The shipped request used an inline `data:` URL. Linq's app-card contract
  requires the `url` field to be HTTPS even when `interactive` is false.
- The configured Messages extension identity matches the shipping extension,
  which rules out identity fallback as the remaining contract violation.
- After that correction deployed, the hosted reply still arrived as the
  deterministic card text while a direct Create Chat probe rendered a native
  static card with the same app identity and HTTPS contract.
- The hosted delivery retained the original provider idempotency key instead of
  the distinct definitive-rejection fallback key. The app card therefore was
  not rejected; it was never attempted.
- The hosted inbound already carries the raw provider chat identifier in its
  trusted reply target; the separate conversation identifier is opaque only for
  model/session continuity.
- Ordinary auto-replies copied that raw reply target into both binding delivery
  and the explicit target override. Because the binding lacked a kind, the
  opaque conversation locator backed the binding while the duplicate explicit
  target won delivery with kind `explicit`.
- Native cards intentionally require kind `thread`, so this duplicated route
  representation skipped the app-card request and sent ordinary text.
- After that route correction deployed, the physical reply still used the
  deterministic text fallback. Runtime evidence showed the direct iMessage
  input arrived after a device-sync invocation had started and joined its live
  turn. The foreground importer retained the decoded direct-recipient context,
  but the delivery phase read only its frozen startup context array. The native
  card eligibility check therefore lacked the ephemeral recipient even though
  the thread binding, directness, card intent, idempotency key, and provider
  capability were all present.

## Success criteria

- The Linq app-card request uses a fixed, non-sensitive HTTPS URL.
- The noninteractive static layout contains the card's date, meal count,
  available nutrition totals, and an explicit marker when any total is partial.
- A V2 layout preserves the first available exact goal and frozen status in
  canonical metric order instead of making goal-resolution work invisible.
- The fallback text remains short and value-free so Apple data detection cannot
  downgrade the app-card presentation.
- Empty assistant text still preserves the singular card delivery.
- Ordinary inbound auto-replies carry the trusted provider reply target once as
  a thread binding and never copy it into the explicit-target override.
- Same-route inputs accepted during the live turn retain that binding, and
  exact-message reply/reaction tools authorize against it without changing the
  turn contract.
- Focused tests prove the exact provider payload and both complete and partial
  layouts.

## Constraints

- Do not persist card contents in a second location or introduce a card-serving
  API, extension network read, additional provider call, or new dependency.
- Retain V1 parsing and deterministic text for existing outbox and fallback
  behavior.
- Keep health values only in the existing outbound provider payload and do not
  place production evidence in durable artifacts.

## Tasks

1. [x] Capture post-deploy evidence and prove the provider-payload boundary.
2. [x] Replace the inline URL with the HTTPS static-card contract.
3. [x] Add exact payload and layout regression coverage.
4. [x] Update architecture, reliability, and deliverability ownership docs.
5. [x] Run focused verification and inspect the candidate diff.
6. [x] Complete the HTTPS correction review, merge, and deploy; use physical
   evidence to isolate the remaining hosted-route failure.
7. [x] Delete the duplicate explicit auto-reply target, including active-turn
   admission, and move exact-message authorization to the existing thread
   binding beside the opaque conversation locator.
8. [ ] Merge, deploy, and verify the real hosted reply on a physical device.
9. [x] Carry the existing invocation-local Linq context from late active-turn
   admission into the existing delivery owner and prove the regression.

## Verification log

- The operator-config focused suite passed with 55 tests across the response
  card and exact Linq request-body owners.
- The operator-config package typecheck passed.
- Three focused assistant-engine regressions passed for empty-text card
  preservation, single outbox ownership, and capability-gated Linq delivery.
- The fixed product URL returned HTTP 200 over HTTPS without carrying card or
  member state.
- The candidate diff passes `git diff --check`, and stale inline-URL encoder
  references are absent from the active implementation and owner docs.
- The preliminary specialist review identified lost goal/status presentation,
  misleading degraded-state copy, and an unproved unavailable-metric branch.
  The corrected layout retains one exact goal/status, the fallback names a real
  text-recovery action, and the accepted coverage patch adds the missing branch
  proof. Physical transcript rendering remains the explicit post-deploy gate.
- Final ReviewGPT round 1 recommended deleting goal-resolution work because the
  first reviewed layout did not consume it. That remedy was rejected against
  the shipped goal-aware product promise; the corrected layout instead makes
  the first canonical available goal and status observable without adding an
  owner. The HTTPS correction subsequently completed review, merged, and
  deployed.
- The rejected first-message workaround added a second provider API path and
  broadened fallback behavior even though the trusted provider thread was
  already present. Those changes were deleted in favor of correcting the
  existing auto-reply route representation at its owner.
- The focused automation, delivery-resolution, and Linq channel suites pass
  with 252 tests. The assistant-engine package typecheck and docs drift check
  also pass.
- Final ReviewGPT found that active-turn admission could recreate the removed
  override and that exact-message tools still gated on it. The accepted
  correction deletes both late override writes and makes the existing
  thread-kind binding the resolver authority; no new route state or provider
  path was added.
- The focused active-turn, targeting-resolver, and turn-planning suites pass
  with 269 tests. They cover no-late-input and late-input routes, binding-only
  direct and group tool contracts for Linq and Telegram, exact accepted-event
  matching, and Telegram business-reaction exclusion. The assistant-engine
  package typecheck also passes on the corrected head.
- The refreshed parent product-experience review found no remaining product
  finding: one ordinary request still uses the existing reply, outbox, and Linq
  owners to return the card in the same chat, while deterministic text remains
  the failure recovery. The only material evidence gap is the already-required
  post-deploy physical transcript proof.
- Six broader affected assistant-engine files pass with 470 tests. The
  monolithic local-service file hit its existing 4 GB worker ceiling after 79
  passing tests when run whole; its three accepted-message authorization and
  second-pass authority tests pass in isolation.
- The late-input correction adds no state or lookup path: the assistant phase
  now combines its initial decoded Linq contexts with the foreground importer's
  existing invocation-local batch before preparing and draining delivery.
- The exact late-active-turn regression passes from an empty startup context to
  outbox preparation and drain with the decoded direct iMessage context. The
  existing matching-context resolver and native app-card capability branch each
  pass independently, and the assistant-runtime suite passes with 2,049 tests
  plus four skips across 81 files.
- The assistant-runtime package typecheck, docs drift guard, and diff check pass
  after the correction.
- The preliminary specialist pass accepted one coverage gap: the phase-level
  late-context proof and the native-card transport proof were separate. The
  existing scheduled-system-work overlap journey now admits a direct nutrition
  request after startup, drives the real response-card tool and delivery owners,
  and asserts one same-chat `imessage_app`, its exact capability recipient, no
  plaintext duplicate, and no Create Chat request.
- The corrected Cloudflare test surface typechecks, and the shared Linq helper
  suite passes with 10 tests. The canonical hosted-local journey is pending its
  runtime execution because the unchanged runner bundle currently exceeds its
  checked-in total-size ceiling; a separately owned, green PR contains the
  measured ratchet, so this lane does not duplicate or weaken that invariant.
- Final ReviewGPT round 1 passed with no findings. It identified only a PR-body
  accounting discrepancy: the restored native path adds the already-existing
  capability probe before the one card-or-text send, rather than keeping the
  old text-only request count.
