# Simplify automatic meal closeout

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Give every member who imports an automatic meal capture a managed 9pm
  closeout without a second opt-in.
- Let that ordinary scheduled assistant turn enrich the captured meal and use
  one canonical tool to remove its retained photo.
- Replace PR #859's meal-specific scheduler and route machinery with the
  smallest composable architecture.

## Success criteria

- A new or replayed canonical automatic meal import idempotently ensures one
  stable 9pm managed automation.
- The managed automation uses ordinary automation scheduling, routing, prompt,
  tool, and delivery behavior.
- The automation can inspect retained automatic-capture photos, enrich the
  canonical meal, and remove each photo through a narrow canonical mutation.
- Explicitly paused or archived automations remain respected.
- No meal-specific cron reconciliation, route repair, terminal-failure
  projection, rollout compatibility, queue, or second state owner remains.
- Focused tests, canonical diff verification, acceptance, product review, CI,
  and ReviewGPT pass for the exact replacement PR head.

## Scope

- Managed automation seed and automatic meal import hook.
- The smallest canonical meal-photo removal command and its CLI exposure.
- Focused tests and directly affected architecture, reliability, security, and
  verification documentation.

## Constraints

- Prefer deletion and existing generic automation behavior over new
  infrastructure.
- Keep raw meal photos out of model-visible durable state after the scheduled
  turn removes them.
- Do not add rollout compatibility for the superseded PR; there are no members
  relying on that implementation.
- Preserve the existing explicit opt-in for iOS photo capture itself. Only the
  follow-up 9pm automation is automatic after a capture is accepted.

## Tasks

1. Trace the latest-main import and managed-automation ownership boundaries.
2. Implement import-time upsert plus the photo-removal primitive.
3. Add focused success, replay, pause/archive, and safe-deletion coverage.
4. Update only durable docs whose current contracts change.
5. Complete verification, product review, ReviewGPT, CI, and replacement PR
   handoff; then close PR #859.

## Evidence

- The accepted upload carries its Web-resolved private direct route in the
  encrypted mailbox envelope. Canonical import then ensures one stable
  `dailyLocal` 21:00 managed automation directly from that envelope; no
  runner-to-Web route callback, meal-specific scheduler, queue, or repair
  state was added.
- The automation prompt uses retained photos as unfinished work and the
  existing scheduled occurrence timestamp as bounded same-occurrence retry
  evidence. The canonical `meal remove-photo` mutation preserves structured
  meal truth and atomically replaces the retained image with a receipt-checked
  tombstone that retains no original-image digest.
- Required product-experience review passed after fixing the private-route
  prerequisite, late-import catch-up, unsolicited nutrition-number behavior,
  and the provider-failure-after-cleanup retry gate. Focused re-review reported
  no findings.
- Focused local verification passed: five affected package/app typechecks;
  assistant-engine 49 tests; hosted-execution 67; assistant-runtime 4; core
  120; CLI 9; and Web route/mailbox/newsletter 101.
- Full Crabbox acceptance passed in 4m35s on Testbox
  `tbx_01ky6vegaee3866a8p17eh8axb`. The only later source edit extracted the
  already-identical direct-route selection into the shared resolver; Web
  typecheck and all 101 directly affected Web tests passed afterward.
- Preliminary exact-head specialist review found three medium gaps. The
  managed seed now delegates the complete closeout procedure to the reusable
  skill and anchors post-midnight retries to the engine-supplied occurrence
  date. Coverage now proves first-route canonicality across direct-route
  drift and retryability after a real automation write failure. Focused
  remediation tests pass: assistant engine 50, assistant runtime 4, and Web
  mailbox 62.
- The intended runner graph exceeded the prior total-byte ratchet while
  remaining inside both entry and static-closure budgets. A complete local
  runner assembly passed at 9,434,851 bytes; the total cap now preserves the
  documented 32KB reviewed-growth margin above that packaged measurement.
- Fresh parent review of the full replacement diff removed a redundant
  importer pre-read: the generic managed-automation owner already preserves
  an existing route, so every import can pass the envelope route through the
  same idempotent ensure call. The review also corrected route-authority
  documentation while retaining only deprecated source-compatible names for
  the generalized direct-route type. No other correctness, privacy, or
  architectural findings remained.
- Local `test:diff` reached and passed the full assistant-engine suite but
  encountered three assistant-runtime diagnostics failures caused by an
  unrelated stale `/tmp` fixture owned outside this task. A clean Crabbox
  `test:diff` then passed all 2,605 assistant-engine and 1,805
  assistant-runtime tests; its later CLI experiment and Linux hosted-harness
  failures were outside this diff and caused by the broad reverse-dependent
  environment lane.
- The first final acceptance run exposed one stale runner-budget test
  expectation after the reviewed cap ratchet. The expectation was aligned
  with the production constant, and the focused 34-test bundle suite passed.
- Final Crabbox acceptance passed in 5m18s on Testbox
  `tbx_01ky6z297txse6sdjn2r49p3q8`, including every workspace guard and
  typecheck, package coverage, the Web build, and all Cloudflare checks.
- Staged diff validation and direct-identifier privacy scan passed.
Completed: 2026-07-23
