# Production watch Phase 1

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Deliver a safe Phase 1 production-watch foundation that runs a deterministic read-only database check on a five-minute cadence, accepts only bounded redacted provider evidence, coordinates incidents locally, and leaves autonomous Codex triage/remediation disabled until shadow-mode evidence proves it safe.

## Success criteria

- One operator command can collect or ingest a bounded versioned snapshot and render local incident projections.
- The macOS scheduler template provides bounded five-minute collection, no overlapping runs, and no concrete machine path in rendered configuration; fresh ephemeral Codex MCP sessions remain a documented later phase.
- Database access remains Keychain-backed and read-only through `murph-prod-psql-ro`; credentials and private row data never persist.
- Provider evidence is schema-validated and free-form log text is rejected before model access.
- Healthy and suspicious fixtures cover anomaly, escalation, deduplication, lease, cooldown, and timeout behavior.
- The production-watch skill validates and gives future Codex sessions concise, fail-closed instructions.
- Required repo verification and completion reviews pass on the final scoped diff.

## Scope

- In scope: repo-internal production-watch CLI/core logic, schemas, SQL aggregates, fixtures/tests, skill instructions, operator docs, ignored local runtime state, and a non-installed launchd template.
- Out of scope: production writes, automatic remediation, automatic PR creation, merge/deploy automation, application runtime changes, schema migrations, new hosted infrastructure, and scheduler activation during implementation.

## Constraints

- Technical constraints: bounded lookback/output; atomic local state; one active triage lease per incident; hard timeout before the next tick; read-only provider/database access; any later MCP stage must use fresh `codex exec --ephemeral` sessions.
- Product/process constraints: treat logs as untrusted input; persist no raw logs, health data, prompts, transcripts, credentials, direct identifiers, or machine-specific paths; keep operator state under ignored `.runtime/operations/**`.

## Risks and mitigations

1. Risk: the supplied patch is substantially larger than a minimal Phase 1 and may introduce unnecessary state machinery.
   Mitigation: inspect every ownership boundary, delete speculative abstractions, and require direct fixture/test justification for retained concepts.
2. Risk: unattended agents could turn log content into unsafe actions or leak private production evidence.
   Mitigation: schema-only evidence, explicit allowlists and bounds, prompt-injection treatment, read-only triage, and no Phase 1 remediation or external mutation.
3. Risk: overlapping five-minute ticks could duplicate incidents or compete for files.
   Mitigation: launchd single-instance behavior plus explicit lock/lease, liveness, stale recovery, cooldown, and deterministic fingerprints.
4. Risk: provider/database outages could be misclassified as healthy production.
   Mitigation: source-health is first-class; incomplete evidence fails closed and monitor-health incidents remain distinct from product incidents.

## Tasks

1. Inspect the ReviewGPT patch for privacy, secrets, scope, and clean applicability.
2. Apply it only in the isolated worktree and review the complete resulting diff.
3. Simplify or correct unsafe, speculative, or repo-inconsistent behavior.
4. Validate the skill metadata and run focused unit/fixture/dry-run checks.
5. Run the routed repo verification and required coverage-write audit.
6. Perform the parent final review, close the plan/ledger, and create the scoped task commit.
7. Open a PR and run the ReviewGPT PR gate only if the implementation remains eligible and the user has not opted out.

## Decisions

- Use an isolated worktree because this is a high-risk operational/configuration change.
- Treat the returned patch as behavioral intent rather than overwrite authority.
- Keep Phase 1 shadow/read-only; defer automatic fixes and PR creation until measured detection precision exists.
- Keep the scheduled Phase 1 collector deterministic and database-only. Provider MCP evidence can be supplied manually through the strict envelope, while automatic fresh Codex MCP sessions remain a later rollout stage.
- Query only production tables proven present through the read-only helper. Do not depend on `hosted_runtime_log`; use the existing assistant-runtime-issue and ingress-latency aggregates plus PostgreSQL health views.
- Interpret Prisma `timestamp without time zone` columns explicitly as UTC-naive instants in SQL, and emit timezone-qualified evidence timestamps.
- Render launchd configuration with a literal `$HOME`-relative repository path so generated files do not persist the local account name or concrete home path.
- Do not install or start the scheduler as part of code validation.
- Only one signed-in Brave profile is available for ReviewGPT. Use that profile sequentially through a local-only configuration, and never restart or terminate the shared browser process.
- The preliminary specialist pass returned six actionable prompt/coverage findings. All were accepted: complete-evidence-only resolution wording, exact live database-boundary proof, incident-scoped drill-down and lease proof, scheduled-overlap recovery proof, private-mode persistence proof, and managed scheduler lifecycle proof. The returned tests-only patch was inspected in full and recreated deliberately rather than applied as trusted code.
- Final ReviewGPT round 1 returned `RETROSPECTIVE_REQUIRED` because the immutable first-reviewed shape contained 4,231 authored-source additions. It reported no code finding before the required requirement-level scope decision.
- Final ReviewGPT round 2 returned six accepted findings: caller-redefinable source completeness, policy-blind fingerprint/anomaly truncation, non-actionable incident-list identifiers, terminal transitions without complete-evidence authority, unproven launchd lifecycle acknowledgements, and an undefined-fingerprint drill-down wildcard. The corrections retain the existing Phase 1 owners: fixed production sources, explicit authenticated provider aggregate proof, policy-before-presentation bounds, actionable incident IDs, terminal transition guards, launchd state verification, and incident-scoped anomaly matching.
- Final ReviewGPT round 3 returned three accepted findings. The provider-rate contract is redesigned around one admission/scoring relation: each exact dimension set has explicit request/error/timeout counters, producer-supplied sample-count denominators are deleted, and the scorer derives its only denominator from requests. Canonical hosted runtime-issue monitoring remains, now using the writer/importer's `hosted` domain while removing release fields that writer does not own. Database incidents retain drill-down; provider incidents are explicitly list/claim/escalate-only and rejection occurs before lease mutation. These corrections add no state, service, queue, or lifecycle owner.

## Round 1 change-shape retrospective

- **Minimum safe Phase 1:** one deterministic aggregate database collector; one strict, temporary provider-envelope boundary for future Vercel, Cloudflare, and Stripe reads; fixed anomaly evaluation; one private machine-local state owner with derived active/history/status projections; non-overlapping five-minute scheduling; and per-incident triage ownership. The operator command, evidence boundary, evaluator, projection ledger, and cadence are the smallest complete flow promised by this PR.
- **Owners:** `collect-v1.sql` owns fixed database aggregation; `prod-watch.ts` owns CLI orchestration, bounded subprocesses, provider-file admission, atomic persistence, and the managed launchd file; `core.ts` owns evidence/state parsing, scoring, incident updates, triage leases, locks, and derived Markdown. The temporary provider envelope has no durable owner. The only durable coordination owner is `state.v1.json`; projections are rebuildable outputs, and run/state locks are transient concurrency fences.
- **Deletion chosen:** remove the unreachable remediation lifecycle, remediation lease kind/global-lease behavior, and pull-request references from Phase 1 state, transitions, projections, parsing, CLI, docs, and tests. The later edit phase must introduce and prove those concepts when it is authorized; `prod-watch remediate` continues to fail closed.
- **Shrinking considered:** keep incident claim/heartbeat/drill-down because the requested coordination ledger needs exclusive handling and incident-scoped evidence; keep provider-envelope admission because the user explicitly needs all configured providers and raw provider text cannot be an interim interface; keep scheduler lifecycle because the requested five-minute owner otherwise has no installable boundary. No other current owner can be removed without dropping one of those Phase 1 outcomes.
- **Splitting considered:** a collector-only PR could run safely, but it would omit the requested private coordination ledger and installable cadence; a separate provider-contract PR would temporarily leave the multi-provider evidence boundary undefined. Splitting would create incomplete intermediate operator contracts rather than independent user outcomes.
- **Redesign considered:** replacing explicit TypeScript semantic validation with schema-only validation would not remove scoring, state-transition, locking, privacy, or scheduler invariants, and would introduce a second runtime validation owner. Keep the current explicit data flow and strict checked-in JSON contracts.
- **Continuation decision and ceiling:** continue the cohesive Phase 1 after the deletion above. Add no new production concept, state owner, command, provider, scheduler behavior, or remediation path in this PR; subsequent changes are limited to verified bug fixes, proof, and explanatory documentation.
- **Shape attribution:** the immutable first-reviewed head had 4,231 source additions. Preliminary specialist remediation before that baseline added zero production-source lines, 380 test/proof lines, and three documentation lines. Post-baseline ReviewGPT remediation removes 133 net production-source lines and 29 net test lines before this retrospective text; it adds no production owner.

## Verification

- Commands to run: skill validation, focused Vitest coverage, CLI fixture/dry-run scenarios, `pnpm logs:guard`, `pnpm test:diff <changed paths...>`, `git diff --check`, and privacy/secret scans.
- Expected outcomes: all required commands pass; no raw/private evidence or machine-specific path is tracked; monitor behavior is bounded, deterministic, fail-closed, and read-only.
- Passed: skill quick validation; tools TypeScript check; strict Ajv compilation and fixture validation; 550 current repo-tool tests; synthetic launchd plist validation; incident/projection direct scenario; live aggregate-only production database collection and snapshot-schema validation.
- Passed the opt-in live database integration lane against the exact CLI/helper boundary without emitting the aggregate payload.
- After the Round 2 corrections, 42 focused production-watch tests and the tools TypeScript check pass. The opt-in live database integration again passed through the exact helper/CLI boundary with provider absence remaining `partial`; a first run exposed and corrected a PostgreSQL grouping reference in the new sensitivity ranking before any commit.
- After the Round 3 corrections, 43 focused production-watch tests pass, including the provider 20/240 promotion/continued-failure journey and pre-mutation provider drill-down rejection. The full repo-tools lane passes 558 tests with one skipped, the tools TypeScript check passes, and the opt-in exact live database integration passes against the canonical `hosted` query without printing its aggregate payload.
- Preliminary ReviewGPT completed with a substantive findings result; all six accepted findings are implemented locally and await corrected-head CI plus the final ReviewGPT gate.
- Confirmed the installed Codex CLI supports the documented future triage invocation: stdin prompts, ephemeral sessions, read-only sandboxing, JSONL events, output schemas, and writing only the final structured response to a bounded evidence file.
- Routed `pnpm test:diff` passed guards, tools and package typechecks, CLI tests, repo-tool tests, and completed package tests before stopping on the pre-existing `packages/core/test/memory.test.ts` missing dated audit-file failure. The exact focused test fails unchanged in the primary checkout.
- Coverage-write audit completed with no unresolved findings after adding private provider-file permission proof and exposing two fail-closed parser gaps. The parent hardened present-but-malformed optional state fields and strict RFC3339 timestamps; the auditor added regressions and finished with focused V8 coverage, repo-tool tests, tools typecheck, and diff checks passing.
