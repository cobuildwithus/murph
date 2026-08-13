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
  migrations, fallback providers, or compatibility state for AgentMail.
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
  runtime preparation, and generated config-schema drift checks pass. Final
  assistant-engine and CLI reruns, exact-head CI, and ReviewGPT audit rounds are
  still pending.

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
- Concepts added: no new owner, state, service, dependency, migration, or
  compatibility layer; local validation rejects email and generic hosted
  delivery fails closed without an injected transport.
- Required continuation proof: zero active AgentMail code/config/current-doc
  references, local rejection coverage, retained Telegram/Linq and hosted email
  suites, generated-schema and deploy-policy checks, docs/legal/changelog
  checks, privacy scans, exact-head CI, and a later ReviewGPT `PASS`.

## Verification

- Commands to select after the returned patch establishes the exact touch set:
  focused tests for assistant-engine, inboxd, inbox-services, operator-config,
  setup-cli, CLI, assistant-runtime, and Cloudflare env/deploy surfaces;
  affected package typechecks; config-schema generation/drift checks; docs and
  dependency guards; `git diff --check`; exact-head GitHub Actions.
- Expected outcomes: retained providers work through their existing owners,
  active AgentMail code/config/current-doc references are absent, no new
  compatibility mechanism exists, and all routed ReviewGPT and CI gates pass.
