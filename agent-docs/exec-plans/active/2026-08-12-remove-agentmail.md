# Remove AgentMail from Murph

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Remove AgentMail as a Murph inbox, assistant channel, setup option, runtime
  credential, deploy secret, and current third-party subprocessor.

## Success criteria

- No production package imports, exports, configures, discovers, polls, sends
  through, or provisions AgentMail.
- Setup, doctor, assistant-channel, automation, and environment surfaces no
  longer advertise or accept AgentMail.
- Current architecture, security, legal, verification, generated schema, and
  package-boundary contracts describe the remaining providers truthfully.
- Focused tests prove the retained Telegram and Linq channel paths and the
  remaining inbox-source composition without AgentMail compatibility code.
- Historical completed plans and published release notes remain immutable
  historical evidence rather than being rewritten.
- The exact pushed PR head passes focused proof, required CI, the preliminary
  ReviewGPT specialist pass, and the final ReviewGPT loop.

## Scope

- In scope: AgentMail-specific source, setup, runtime/config exports,
  assistant/inbox wiring, env and deploy policy, generated current config
  schema, current docs/legal disclosures, and focused tests.
- Out of scope: adding a replacement email provider, rewriting immutable
  completed plans or published release notes, removing generic email types
  still required by hosted email or other providers, and unrelated channel
  refactors.

## Constraints

- ReviewGPT authors the initial implementation patch; the parent inspects every
  hunk, applies only the scoped architecture-compatible change, and completes
  any proof or remediation required by audits.
- Prefer deletion and hard cuts. Do not add aliases, stubs, feature flags,
  fallback providers, or ongoing compatibility state for AgentMail. A bounded,
  deletion-only version transition may discard persisted retired local email
  state so an upgrade cannot block the remaining Telegram/Linq journey.
- Preserve generic email behavior that is still owned by hosted ingress,
  Resend, connected apps, or signed group-email routes.
- Do not expose credentials, local identifiers, member data, or private
  evidence in prompts, patches, commits, tests, docs, or PR artifacts.

## Risks and mitigations

1. Risk: keyword deletion removes generic hosted email behavior.
   Mitigation: classify each email surface by provider owner and remove only
   AgentMail-owned local ingestion, setup, delivery, and credentials.
2. Risk: source deletion leaves exported types, generated schema, env allowlists,
   or package boundaries stale.
   Mitigation: trace imports/exports and run source-graph, package, schema,
   environment, and focused channel tests.
3. Risk: historical references make a zero-match rule destructive or false.
   Mitigation: preserve immutable completed plans and published release notes;
   require zero active runtime/config/current-doc references instead.

## Tasks

1. Map current AgentMail owners, call paths, tests, docs, env, deploy, and
   generated surfaces from current `origin/main`.
2. Send a guarded implementation request to ReviewGPT and require a downloadable
   patch plus invariant and verification notes.
3. Inspect and deliberately apply the patch, remove residual active references,
   and run focused tests, typechecks, schema/docs drift, and privacy/diff checks.
4. Commit and push the candidate, open the PR with the complete intent contract,
   and launch exact-head CI plus both ReviewGPT stages concurrently.
5. Reproduce and resolve accepted findings, run subsequent final ReviewGPT
   rounds as required, complete the parent final review, and close this plan.

## Progress

- ReviewGPT returned an apply-ready full-repository removal patch against the
  exact starting head. The patch was inspected, privacy-scanned, checked with
  `git apply --check`, and deliberately applied.
- Parent inspection removed residual current configuration and test-fixture
  references, repaired retained-provider test typing, aligned architecture and
  legal dates, and updated stale local-email rejection assertions discovered by
  the full package suites.
- Active source/config/current-doc scans now find no AgentMail import, export,
  runtime key, base URL, setup surface, or operational claim outside the
  explicitly preserved historical records.
- Affected package typechecks, operator-config, inbox-services, setup-cli,
  assistant-cli, inboxd, assistant-runtime, Cloudflare env/deploy tests, built
  runtime preparation, generated config-schema drift checks, assistant-engine,
  and CLI suites pass. Exact-head CI and ReviewGPT audit rounds are still
  pending.
- The preliminary ReviewGPT specialist pass found one accepted high-severity
  upgrade defect plus its associated medium-severity proof gap: a prior
  versioned local-email connector invalidated the whole retained inbox config,
  and active local email automations remained retryable. The correction moves
  the inbox config to schema version 2, atomically deletes only version-1 local
  email connector records, preserves Telegram/Linq records, pauses active local
  email automations before execution, and reports one actionable setup summary.
  Direct reconciliation, strict setup, idempotency, no-turn/no-retry, and
  hosted-email non-regression tests now cover the finding.
- Corrected-head product-purpose revalidation: the irreducible outcome is a
  provider hard cut that leaves upgrading local users on a working supported
  path. The bounded destructive cleanup is the smallest complete experience:
  it adds no provider call, credential read, mailbox resolution, alias,
  replacement provider, or continuing compatibility service. No product
  finding remains in the corrected journey, and the production-faithful setup
  scenario closes the material evidence gap.
- Binary-safe residue review found that the checked-in current legal PDFs still
  carried the retired subprocessor after the Markdown source changed. The PDF
  generator, legal index, manifest, and current/versioned August 12 artifacts
  now agree; the published dated PDFs from prior versions remain immutable.
- Final ReviewGPT round 2 reviewed pre-remediation head `04c00f81cf` and returned
  three original-PR findings. The persisted-config finding is accepted and
  resolved by the version-2 reconciliation above. The legal version-identity
  portion is accepted and resolved by the new August 12 source/index/generator,
  current alias, manifest, and versioned PDFs. Its request to keep AgentMail in
  the current register for old installed binaries is rejected: those binaries
  use a locally supplied credential, are not part of the current code or
  supported provider set, and retain their dated disclosure artifacts; keeping
  the provider in the current register would make the current document false.
- Round 2 also found an accepted local prompt gap: automation guidance still
  suggested asking for email-routing details before the command rejected the
  route. Local guidance now names Telegram/Linq as the supported automation
  routes and redirects email intent before soliciting any route data; hosted
  email guidance remains unchanged. Focused assembled-prompt tests cover both
  sides of that boundary.
- Final ReviewGPT round 3 found two additional upgrade-safety gaps. First,
  removing the provider name also removed its permanent hosted secret-prefix
  deny rules, allowing a stale operator allowlist to reintroduce a retired
  credential. The `AGENTMAIL_` prefix is restored only at both negative trust
  boundaries and is covered through stored-payload, runtime-user-env, and final
  Codex child-env tests; this is a tombstone, not runtime compatibility.
- Second, the earlier local migration covered canonical scheduled automations
  but not the separately persisted assistant auto-reply state. A deletion-only
  reconciliation now removes the literal legacy `email` auto-reply entry during
  setup and before any direct local automation scan, including upgrades that
  skip setup. It preserves Telegram, Linq, custom channels, and hosted email;
  real-file setup, idempotency, direct pending-input/no-provider-turn, mocked
  scan-order, and hosted non-regression tests cover the correction.
- Final ReviewGPT round 4 found that the retired credential could still reach
  setup provisioning subprocesses through the persisted environment path.
  Setup now scrubs that credential alongside active provider credentials before
  spawning tools, while retaining the negative trust-boundary tombstones.
- Final ReviewGPT round 5 found a second local automation store used by the
  live version-1 cron runtime. The pre-claim cleanup now pauses matching jobs in
  both canonical automation state and that locked local cron store, combines
  the transition count, preserves Telegram and Linq jobs, and remains
  idempotent. Production-path runtime and setup tests cover the correction.
- Final ReviewGPT round 6 found that strict inbox readiness could throw after
  cleanup but before the one-time recovery guidance was constructed, and also
  identified obsolete single-provider indirection. Strict readiness now belongs
  to setup after cleanup reporting is derived; the same error code carries the
  completed cleanup guidance through terminal and structured output, and a
  corrected rerun is byte-stable without a duplicate announcement. The
  one-provider setup and doctor registries and the unused channel setup hook
  have been deleted in favor of direct Telegram paths, removing more production
  code than the correction adds.

## Change-shape retrospective

- Trigger: final ReviewGPT round 1 independently counted 3,315 lines of
  authored-source churn across 38 source files, above the 3,000-line
  strong-red-flag threshold. The first-reviewed implementation head added no
  review-driven source growth.
- Decision: continue as one indivisible provider hard cut. Splitting runtime,
  ingestion, setup, assistant routing, generated schema, deploy policy,
  current docs, or legal disclosure would temporarily leave AgentMail
  advertised, callable, or disclosed inconsistently across owners.
- Concepts removed: AgentMail API/config, polling and provider normalization,
  setup/provisioning/readiness/doctor flows, local assistant email delivery and
  retry, provider credentials/schema/deploy policy, current provider claims,
  and provider-specific tests.
- Concepts retained: Cloudflare Email ingress, hosted mailbox staging,
  provider-neutral parsed-email normalization, explicitly injected hosted
  email delivery, verified and signed hosted email routes, Resend, connected
  apps, and transactional or newsletter email. Those have separate owners and
  remain required by supported hosted behavior.
- Concepts added: bounded deletion-only transitions for inbox schema, canonical
  local automations, and legacy local auto-reply state, plus a permanent
  negative secret-prefix tombstone at existing trust boundaries. No new owner,
  service, dependency, provider compatibility layer, or replacement delivery
  path was added; local validation rejects email and generic hosted delivery
  fails closed without an injected transport.
- Required continuation proof: zero active AgentMail code/config/current-doc
  references, local rejection coverage, retained Telegram/Linq and hosted email
  suites, generated-schema and deploy-policy checks, docs/legal/changelog
  checks, privacy scans, exact-head CI, and a later ReviewGPT `PASS`.

## Verification

- Passing local proof includes the affected package typechecks; full
  inbox-services and setup-cli suites; assistant cron/channel, local-service,
  operator-config, CLI setup/automation, and legal-page tests; deterministic
  legal PDF generation and visual inspection; generated-schema and docs drift
  checks; `git diff --check`; active text/binary residue scans; and privacy
  scans. The broad assistant-engine run passed every other file at the default
  heap, while its largest local-service file passed separately with an 8 GB
  heap after the default 4 GB worker exhausted memory.
- Complete provider-input measurement used the pinned real Codex App Server,
  a hermetic Responses endpoint, `gpt-5.6-terra` with low reasoning, the built
  assistant CLI contract, and production code mode against exact merge base
  `023ec1b6e7` and the corrected working head. The individual local Telegram
  request changed from 30,877 tokens / 140,841 bytes to 30,918 tokens / 141,071
  bytes: +41 tokens (+0.1328%) and +230 bytes, entirely in the developer-message
  `input` item. The hosted group Linq request remained 27,598 tokens / 127,911
  bytes. No selected provider field besides `input` changed. Paths and volatile
  identifiers were normalized, and the temporary capture harness and artifacts
  were removed after measurement.
- The round-6 corrected head passes all four touched-package typechecks, full
  setup-cli and inbox-services suites, the full CLI setup/channel slice, and the
  assistant channel suite. Final ReviewGPT and exact-head GitHub Actions remain
  required before closure.
- The base branch advanced again after the single permitted refresh and now
  conflicts in the generated skill hash and plan index. Per the repository
  moving-base rule, no second refresh is attempted; closure remains blocked on
  that race even if the final audit passes.
- Expected outcomes: retained providers work through their existing owners,
  active AgentMail code/config/current-doc references are absent, no new
  compatibility mechanism exists, and all routed ReviewGPT and CI gates pass.
