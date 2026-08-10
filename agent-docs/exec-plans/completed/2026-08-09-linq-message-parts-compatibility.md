# linq-message-parts-compatibility

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Accept Linq `message.received` compatibility payloads whose optional legacy
  `parts` field is absent or null without creating retrying 400s, support the
  current documented inbound `imessage_app` part, and emit metadata-only warn
  diagnostics whenever compatibility handling or invalid part structure is
  observed.

## Success criteria

- Missing or null `parts` normalizes to the existing empty-message path, which
  journals and acknowledges the provider event without waking the assistant.
- Non-array, non-null `parts` remains invalid and emits a warning containing
  only fixed structural facts and bounded identifier suffixes.
- Current documented `imessage_app` parts preserve bounded fallback text for
  assistant processing while omitting card URLs and provider-owned app/layout
  metadata from canonical payloads and logs.
- Unknown-sender direct and group admission screens the same fallback text with
  one mode-independent first-contact disposition before side effects; a card
  without fallback stays contentless while legacy media-only behavior remains
  unchanged.
- Existing text, link, media, voice memo, retry, dedupe, and webhook signature
  behavior remains unchanged.
- The two existing Linq SDK consumers use the current public-registry release
  with the committed lockfile and dependency guards passing.

## Scope

- In scope: shared Linq ingress parsing/minimization, hosted Web structural warn
  logging and mailbox normalization, focused inbox metadata normalization,
  current SDK pins, tests, and current owner docs.
- Out of scope: schema migrations, new queues/state owners, raw payload logging,
  provider message refetch, webhook signature migration, and Cloudflare runtime
  changes.

## Constraints

- Technical constraints: diagnostics must be metadata-only; never log message
  content, handles, chat/message ids, URLs, app metadata, or raw request bodies.
- Product/process constraints: do not silently turn malformed structured parts
  into content, and do not wake the assistant for a genuinely contentless event.

## Risks and mitigations

1. Risk: relaxing validation could hide a provider contract regression.
   Mitigation: relax only absent/null legacy content, retain strict rejection
   for other types, and warn with the selected shape and version.
2. Risk: app-card metadata may contain capabilities or private values.
   Mitigation: retain only bounded `fallback_text` as user-visible content and
   discard URL, app, and layout fields at ingress.
3. Risk: an SDK upgrade changes unrelated provider surfaces.
   Mitigation: use the exact public-registry release, inspect its changelog and
   webhook types, and run both dependency guards plus focused typechecks/tests.

## Tasks

1. [x] Confirm current official Linq webhook contracts and the latest SDK package.
2. [x] Add compatibility parsing, current part support, and privacy-safe warnings.
3. [x] Add focused parser, Web service/logging, mailbox, and inbox regressions.
4. [x] Update the live owner docs and SDK pins/lockfile.
5. [x] Run focused verification, dependency guards, exact-head review gates, and CI.

## Decisions

- The current SDK is `0.34.0`. Its 2026 message event requires `parts`, while
  its legacy nested message model keeps `parts` optional; production evidence
  shows the provider can still omit the field. Treat absent/null as an empty
  compatibility payload and keep other non-array values invalid.
- Support the SDK's documented `imessage_app` part explicitly rather than
  treating all unknown provider part kinds as acceptable.
- Use one fallback-text interpretation across active-member mailbox delivery
  and unknown-sender admission. Keep the fixed contentless placeholder confined
  to accepted active-member canonicalization.
- Round 2 exposed that the first correction still depended on optional
  admission. The recorded retrospective chose a shared allow/blocked/contentless
  disposition in the existing first-contact owner, evaluated after identity but
  before direct signup or unbound-group setup. This replaces the prior boolean
  screen and adds no owner, queue, state, wait, or compatibility path.

## Verification

- Focused Messaging Ingress (49), Inboxd (19), hosted Web (184), and
  operator-config (65) tests pass.
- After both first-round review gates identified the same first-contact gap, the
  hosted dispatch regression suite passes 176 tests covering direct, group,
  contentless, URL, and opt-out app-card fallback cases.
- After the round-2 retrospective redesign, the hosted dispatch suite passes
  178 tests, including default/off direct and group contentlessness, the
  active-member placeholder, and unchanged media-only signup.
- Affected Messaging Ingress, Inboxd, operator-config, and hosted Web
  typechecks pass. The SDK upgrade required one outbound read to tolerate the
  newly optional SDK `message.parts` property; request construction is
  unchanged.
- `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm logs:guard`,
  `pnpm docs:drift`, frozen-lockfile install, and `git diff --check` pass.
- `pnpm deps:audit` remains blocked by repository-pre-existing transitive
  advisories. None of its reported paths includes `@linqapp/sdk`, and the
  lockfile diff adds no new SDK transitive dependency.
- The production-shaped signed-webhook hosted-local regression is authored but
  its isolated lane is blocked before Vitest starts: runner bundle preparation
  twice timed out in the unchanged `vault-cli --llms-full --format json`
  manifest step. A standalone assistant-engine build succeeded once; subsequent
  standalone generation reproduced the same timeout. Focused dispatch coverage
  and exact-head CI remain the executable proof for this change.
- Final ReviewGPT round 2 required a retrospective for the default/off mode
  gap. The retrospective is recorded in the PR body; round 3 and exact-head CI
  remained pending after the corrected candidate was pushed.
- Final ReviewGPT round 3 reviewed the fresh full snapshot at `ff187133ac`,
  returned `ROUND_OUTCOME: PASS`, and produced no qualifying findings after
  verifying the tri-state boundary, legacy media behavior, active-member
  placeholder, payload minimization, and warning fields.
- Exact-head CI passed the task-affecting build, typecheck, package, fixture,
  sandbox, dependency, and design-proof shards. Two unrelated frontend jobs
  failed on stale assertions and an unscoped design-proof scenario from files
  untouched by this PR; the latest `main` contains their repairs and merged
  cleanly under the ReviewGPT base-update-only exception.
Completed: 2026-08-09
