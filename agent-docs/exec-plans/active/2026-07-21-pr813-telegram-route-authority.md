# PR 813 Telegram route authority remediation

Status: active
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Keep scheduled Telegram current-chat newsletters reachable while proving that
  the exact Web-owned thread container and Telegram group remain coupled before
  shared health data can reach the model and immediately before provider entry.

## Success criteria

- A production-path regression proves a stored Telegram target that does not
  match the live thread-route owner fails before model work and `read_shared`.
- A scheduled Telegram group newsletter persists the exact live route authority
  on its ordinary outbox intent and rechecks that same authority immediately
  before every Telegram provider effect.
- Route-owner unavailability or disagreement takes the existing retryable or
  permanent fail-closed disposition without sending or exposing another
  group's data.
- Valid Telegram group setup, scheduled shared read, ordinary outbox delivery,
  email newsletter revision fences, and existing Linq behavior remain passing.
- Required diff verification, coverage audit, parent final review, CI, and the
  next ReviewGPT correction round all complete with no accepted finding.

## Scope

- In scope: the existing Web thread-route authority owner, its signed hosted
  runtime callback, scheduled group-route resolution, ordinary outbox authority
  persistence, Telegram provider-entry revalidation, focused unit/integration
  and hosted-local proof, and matching durable contracts.
- Out of scope: a new route store, queue, scheduler, migration, reconciliation
  loop, provider-specific authority owner, campaign system, or changes to email
  recipient consent and automation-revision authority.

## Constraints

- Technical constraints: derive authority from the current Web route owner;
  persisted automation targets remain hints; carry one narrow typed proof
  through the existing outbox; fail closed before private model/tool work and
  again before irreversible Telegram provider entry.
- Product/process constraints: preserve Telegram current-chat newsletters,
  keep the architecture smaller than another channel-specific lifecycle, honor
  the ReviewGPT round-2 retrospective, and keep deployment consumer-first.

## Risks and mitigations

1. Risk: a partial Web/runtime rollout makes scheduled Telegram newsletters
   temporarily unavailable.
   Mitigation: add the Web verifier first, deploy Web before an immediate runner
   rollout, and return a retryable pre-model/pre-provider failure while absent.
2. Risk: authority is checked before composition but lost on queued delivery.
   Mitigation: persist the exact typed authority on the existing outbox intent
   and re-read/recheck it at every Telegram provider-entry callback.
3. Risk: broad generalization disturbs direct Telegram or Linq delivery.
   Mitigation: apply the new group-route contract only to non-direct external
   thread delivery and retain Linq's existing engagement/dispatch owner.

## Tasks

1. Record the required repeated-mechanism retrospective and continuation
   decision against the immutable first-reviewed baseline.
2. Add a failing production-path regression for mutated/unavailable Telegram
   route authority before shared reads and provider entry.
3. Expose the existing Web thread-route assertion through the narrow signed
   runtime effects boundary and carry its exact proof through scheduled turns
   and the ordinary outbox.
4. Recheck the proof before Telegram text, image, reaction, and voice provider
   entry and reject Bot API target migration while that proof is bound; keep
   direct delivery and Linq ownership unchanged.
5. Update durable docs, run focused and canonical verification, complete the
   required coverage audit and parent final review, close the plan, push, and
   run the next ReviewGPT correction round concurrently with CI.

## Decisions

- Continue in PR 813 rather than split the stated Telegram outcome: the flaw is
  in remediation-added scheduled Telegram reachability, and the smallest fix is
  to extend the already-generic Web thread-route assertion through existing
  effects/outbox boundaries. Add no durable owner or lifecycle.
- Treat the round-2 High finding as accepted: static code-path evidence proves
  hosted Telegram bypasses live route resolution before model work and provider
  entry while the scheduled shared reader remains enabled.
- Reuse the existing error contract: a missing effect or transient owner
  failure is retryable, a local authority/target mismatch is stale, and Web
  ownership revocation remains its existing permanent unauthorized result.
  Translating those outcomes into another error layer would add no safety.
- Treat the round-3 High finding as accepted: Telegram's existing
  `migrate_to_chat_id` retry could change the provider target after the live
  route check. Carry the already-authorized serialized target into the existing
  Telegram helpers and reject a different migrated target before retrying.
  Ordinary immediate sends retain migration because they omit that constraint;
  recovery for a scheduled route remains an explicit re-save from the new chat.

## Verification

- Passed focused affected suites for Web route/store, Cloudflare platform and
  outbound policy, assistant cron/outbox/runtime callbacks, and
  hosted-execution route exports; affected package/app typechecks also passed.
- Passed the full hosted-local `telegram-scheduled-reminder --no-bundle`
  scenario (2 tests, 451.76s), including real structured newsletter setup,
  alarm wake, `read_shared`, and exact group-thread delivery alongside the
  direct-reminder control.
- Passed canonical affected-owner verification with
  `NODE_OPTIONS=--max-old-space-size=8192`
  and `MURPH_TEST_DIFF_VITEST_MAX_WORKERS=2`: all selected packages/apps,
  scenario integrity, lint, Web dev smoke/build, and Cloudflare Node/Workers
  lanes completed successfully.
- Passed the prior pushed head's full acceptance verification and exact-head
  PR CI. For the provider-migration correction, affected typechecks and focused
  text, image, reaction, voice, descriptor, and hosted callback tests pass.
- Passed canonical diff verification for the provider-migration correction,
  including all affected reverse dependents and Cloudflare Node/Workers lanes.
  The required coverage audit added one hosted image/reaction wiring regression;
  all focused suites and final privacy/diff checks pass.
- Pending for the final correction head: acceptance verification, hosted-local
  proof, exact-head preflight, green PR CI, and ReviewGPT
  `ROUND_OUTCOME: PASS`.
