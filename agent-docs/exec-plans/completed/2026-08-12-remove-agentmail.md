# Remove AgentMail from Murph

Status: completed
Created: 2026-08-12
Updated: 2026-08-14

## User evidence and decision

- The user confirms that nobody uses or has used AgentMail in Murph.
- Murph therefore has no installed AgentMail state, rollback requirement,
  retained credential, or compatibility obligation.
- Earlier review rounds inferred that such state could exist and added
  migrations, cleanup behavior, deny-list tombstones, and fallback exceptions.
  That inference is superseded by the user's evidence.
- The implementation direction is a zero-compatibility hard removal: preserve
  the deletion of the provider itself and delete every mechanism whose only
  purpose was to reconcile hypothetical AgentMail state.

## Goal

- Remove AgentMail as a Murph inbox, assistant channel, setup option, runtime
  credential, deploy secret, and current third-party subprocessor.
- Keep the resulting repository on the smallest current-only Telegram/Linq
  design, without an AgentMail migration or compatibility layer.
- Preserve separately owned generic hosted email behavior.

## Success criteria

- No production package imports, exports, configures, discovers, polls, sends
  through, provisions, migrates, or tombstones AgentMail.
- Setup, doctor, automation, self-delivery, environment, generated config, and
  current documentation contain no AgentMail compatibility behavior.
- Local setup and local assistant routing retain their supported Telegram/Linq
  boundaries.
- Provider-neutral hosted email ingress and delivery, signed hosted email
  routes, Resend, connected-app email actions, and account/service email remain
  unchanged.
- Current legal and architecture artifacts are truthful; immutable completed
  plans, published release notes, changelogs, and prior dated legal artifacts
  remain historical evidence.
- The exact pushed PR head passes focused tests, affected typechecks, generated
  and documentation drift checks, privacy/residue review, required CI, and a
  subsequent ReviewGPT `PASS`.

## Scope

- In scope: AgentMail-specific source, setup, runtime/config exports,
  assistant/inbox wiring, credentials and deploy policy, current generated
  schema, current docs/legal disclosure, and tests for those owners.
- In scope after the user correction: deleting the review-added inbox schema
  reconciliation, cron and auto-reply cleanup, secret tombstones, setup cleanup
  reporting, self-delivery fallback exceptions, and their tests.
- Out of scope: adding a replacement provider, removing provider-neutral email
  by keyword, or rewriting immutable historical artifacts.

## Constraints

- Prefer deletion and current-state owners. Add no alias, migration, feature
  flag, fallback sender, cleanup service, compatibility schema, or speculative
  abstraction.
- Preserve generic email behavior owned by hosted ingress, hosted delivery,
  Resend, connected apps, newsletters, billing/support, and signed group-email
  routes.
- Keep independently simpler round-6 reductions, including direct Telegram
  setup and doctor implementations and removal of unused channel setup hooks.
- Do not expose credentials, local identifiers, member data, or private
  evidence in prompts, patches, commits, tests, docs, or PR artifacts.

## Tasks

1. Inventory AgentMail-owned runtime, setup, config, docs, legal, generated, and
   test surfaces while classifying generic email owners separately.
2. Have ReviewGPT author the initial provider-removal implementation and inspect
   every applied hunk.
3. Apply the user-established zero-compatibility correction by deleting all
   review-added historical-state mechanisms and restoring simple ownership.
4. Run focused tests, affected typechecks, generated/schema checks, docs drift,
   diff hygiene, privacy scans, and active residue classification.
5. Commit and push the correction, update the draft PR intent contract, and run
   exact-head CI concurrently with a fresh full-patch ReviewGPT audit.
6. Resolve actionable findings until ReviewGPT returns `PASS`, complete the
   parent review, and close the plan when all required gates are satisfied.

## Progress

- ReviewGPT authored the original provider-removal patch against the exact
  starting head. Parent inspection applied it and completed focused repairs,
  current docs/legal alignment, generated artifacts, and retained-provider
  proof.
- The original hard cut deleted AgentMail provider source, local inbox polling,
  local delivery, setup/provisioning, credentials, schema fields, deployment
  configuration, current documentation, and current legal disclosure.
- Current legal PDF source, manifest, current aliases, and versioned August 12
  artifacts remain aligned. Prior dated legal artifacts remain immutable.
- Local automation prompt guidance truthfully names Telegram/Linq, while hosted
  email guidance remains provider-neutral.
- Round-6 direct Telegram setup/doctor simplification and deletion of unused
  channel readiness hooks remain because they reduce production code without
  serving compatibility.
- After the user supplied the missing usage fact, ReviewGPT traced the complete
  compatibility layer and validated the zero-compatibility shape. ChatGPT did
  not serialize its large inline diff completely, so the parent reconstructed
  those exact deletion decisions from the remediation commits and current
  symbol graph before local verification.
- Inbox config is restored to its single current schema, strict readiness is
  restored to inbox bootstrap, and setup delegates strictness directly.
- Cron pausing, auto-reply deletion, secret tombstones, setup cleanup summaries,
  self-delivery fallback exceptions, negative-only CLI cleanup, and proof-only
  fixtures for hypothetical historical AgentMail state are removed.
- ReviewGPT round 8 returned `PASS` with no findings on the exact pushed
  zero-compatibility head. The user then explicitly opted out of further
  ReviewGPT runs and authorized conflict resolution and merge.
- Current `main` was integrated with a normal two-parent merge. The four
  bounded conflicts preserve the reviewed AgentMail-free ownership statement,
  retain current-main device-sync and assistant prompt guidance, and regenerate
  the CLI schema/hash from the combined source.

## Audit ledger

- Preliminary specialists and final ReviewGPT rounds 1-7 found issues only after
  assuming that historical AgentMail state could exist. Those rounds added
  inbox reconciliation, automation cleanup, secret tombstones, setup recovery
  guidance, and self-delivery cleanup. The user has now disproved that premise,
  so those mechanisms and their tests are intentionally deleted rather than
  retained as dormant complexity.
- Separate findings remain valid and retained: the current legal PDFs match the
  current disclosure, local prompt guidance does not solicit unsupported email
  routing, and obsolete single-provider registries/hooks stay removed.
- The prior seven-round cap is explicitly superseded by the user's request to
  continue with subsequent ReviewGPT audits after this architecture correction.
  A fresh full-patch round is required because the user-established fact changes
  the intended solution, not merely one remediation hunk.

## Change-shape retrospective

- The task remains one indivisible provider hard cut. Splitting source, setup,
  runtime, generated config, current docs, or legal disclosure would leave an
  inconsistent advertised or callable provider surface.
- Concepts removed: AgentMail API/config, polling and normalization, setup and
  doctor flows, local assistant delivery, credentials/deploy configuration,
  current provider claims, provider tests, and every review-added compatibility
  or cleanup mechanism.
- Concepts retained: generic hosted email ingress and delivery, mailbox staging,
  signed hosted email routes, Resend, connected apps, transactional email,
  Telegram, and Linq. These have separate supported owners.
- Concepts added: none. The correction deletes speculative compatibility state
  and restores existing current-state owners.

## Verification

- Required local proof: affected package typechecks; focused/full owner tests
  for inbox-services, setup-cli, assistant-engine, assistant-cli,
  operator-config, assistant-runtime, Cloudflare env policy, and built CLI
  setup/assistant/cron paths; generated CLI schema/hash checks; docs drift;
  `git diff --check`; privacy scans; and active AgentMail residue classification.
- Corrected-head local proof passes under the repository's Node 24.14.1 engine:
  all eight affected package typechecks; operator-config (308), inbox-services
  (67), setup-cli (108), assistant-cli (128), focused assistant-engine (509),
  assistant-runtime environment (40), Cloudflare runner-secret (7),
  production-built CLI setup/assistant/cron/hash (116), and web changelog (45)
  tests; CLI schema/hash generation; changelog generation; docs drift; and
  source-sidecar hygiene.
- ReviewGPT round 8 returned `PASS` with no findings on correction head
  `658c0baee5525bb41889ffc0667e5d6d72566fe1`.
- After the user-authorized current-main merge, all eight affected package
  typechecks pass; operator-config (318), inbox-services (67), setup-cli (108),
  assistant-cli (128), focused assistant-engine (583, including the corrected
  prompt-budget rerun), assistant-runtime environment (40), Cloudflare secret
  policy (7), production-built CLI setup/assistant/cron/hash (116), and web
  changelog (45) tests pass. Runtime preparation, CLI schema/hash generation,
  docs drift, source-sidecar hygiene, diff hygiene, privacy checks, conflict
  marker checks, and active-residue classification pass.
- Required remote proof on the final closed-plan head is GitHub Actions. Per
  the user's explicit instruction, no further ReviewGPT round is required.
Completed: 2026-08-14
