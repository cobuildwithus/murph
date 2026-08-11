# Newsletter as a group automation

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make newsletter behavior a `group-newsletter` skill recipe over an ordinary
  group-scoped automation and ordinary shared-data reads.
- Preserve email delivery through one generic, authorized group-email effect
  rather than a newsletter-specific runtime subsystem.
- Delete newsletter recognition, policy, routing, mailbox, and outbox concepts
  from runtime owners after the bounded legacy-record transition.

## Success criteria

- New newsletter setup uses ordinary `murph.automation action="save"` with no
  reserved delivery tags or structured newsletter compiler.
- Scheduled execution is ordinary automation execution; cron does not inspect a
  newsletter slug, tag, prompt marker, or delivery mode.
- Email preparation and send are exposed as generic `murph.group` actions and
  retain current membership, consent, exact-grant, verified-address,
  revision/occurrence, revalidation, idempotency, and durable outbox safety.
- Current-chat delivery uses the ordinary group response/outbox.
- The newsletter-specific tool, Cloudflare port and route, missing-email mailbox
  lifecycle, and newsletter-named outbox settlement are deleted or renamed at
  their generic owner boundary.
- Outside the skill, product documentation, bounded legacy migration, and
  recipe-level tests, runtime code has no newsletter-recognized capability,
  route, mailbox kind, cron branch, outbox type, or authorization service.
- Focused local proof, direct scenario proof, preliminary specialist ReviewGPT,
  final ReviewGPT, exact-head CI, parent final review, and merge proof complete
  with no unresolved accepted findings.

## Scope

- Assistant Engine automation, group-tool, cron, skill, notification, and outbox
  owners plus focused tests.
- Assistant Runtime group-tool bridge, mailbox import, callbacks, platform
  contracts, and focused tests.
- Hosted Execution shared contracts/builders/parsers for generic group email.
- Cloudflare generic group-tool transport and Web control forwarding.
- Web group-email authorization, recipient revalidation, outbox fanout, and
  internal callback route.
- Current architecture, security, reliability, newsletter product spec, and
  verification documentation required to describe the final ownership.

## Constraints

- The skill owns behavior, never authority.
- Group-email disclosure remains fail-closed at prepare and irreversible send
  boundaries and cannot gain authenticated group-control authority.
- Preserve exact automation revision/occurrence identity across retries and
  accepted effects.
- Add no new state owner, queue, service, dependency, feature flag, or permanent
  compatibility layer.
- Preserve unrelated worktree changes and confidential evidence.

## Tasks

1. [x] Recover the saved branch, merge current `main`, and preserve the landed
   group-newsletter sharing behavior.
2. [x] Inventory the complete newsletter runtime surface and identify the
   smallest generic group-email owner seam.
3. [x] Implement the generic group-email effect, migrate the skill recipe, and
   delete newsletter-only runtime machinery.
4. [x] Add or rename focused regression coverage and run local typecheck/tests
   plus direct scenario proof.
5. [ ] Commit and push the candidate, open the public PR with the required
   intent contract, and run specialist/final ReviewGPT concurrently with CI.
6. [ ] Resolve accepted findings, complete parent review and merge proof, close
   this plan through `scripts/finish-task`, and drive the PR to completion.

## Verification log

- Passed focused Assistant Engine, Assistant Runtime, Hosted Execution,
  Cloudflare, and Web suites covering generic group-email preparation/send,
  recipient and grant revalidation, occurrence-scoped idempotency, ordinary
  current-chat delivery, legacy proof parsing, and removed mailbox behavior.
- Passed changed-owner typechecks for Assistant Engine, Assistant Runtime,
  Hosted Execution, Cloudflare, hosted Web, and Operator Config.
- Passed the private skill repository's `pnpm group-skills:test` and full
  `pnpm verify` after migrating the recipe to ordinary automation save and the
  generic `murph.group` email effect.
- Exact-head ReviewGPT, GitHub Actions, merge proof, and release sequencing
  remain the PR completion gates.
Completed: 2026-08-10
