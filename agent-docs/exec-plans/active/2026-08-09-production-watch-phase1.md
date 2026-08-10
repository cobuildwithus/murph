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

- Technical constraints: bounded lookback/output; atomic local state; one active remediation lease; hard timeout before the next tick; read-only provider/database access; any later MCP stage must use fresh `codex exec --ephemeral` sessions.
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

## Verification

- Commands to run: skill validation, focused Vitest coverage, CLI fixture/dry-run scenarios, `pnpm logs:guard`, `pnpm test:diff <changed paths...>`, `git diff --check`, and privacy/secret scans.
- Expected outcomes: all required commands pass; no raw/private evidence or machine-specific path is tracked; monitor behavior is bounded, deterministic, fail-closed, and read-only.
- Passed: skill quick validation; tools TypeScript check; strict Ajv compilation and fixture validation; 374 repo-tool tests; synthetic launchd plist validation; incident/projection direct scenario; live aggregate-only production database collection and snapshot-schema validation.
- Confirmed the installed Codex CLI supports the documented future triage invocation: stdin prompts, ephemeral sessions, read-only sandboxing, JSONL events, output schemas, and writing only the final structured response to a bounded evidence file.
- Routed `pnpm test:diff` passed guards, tools and package typechecks, CLI tests, repo-tool tests, and completed package tests before stopping on the pre-existing `packages/core/test/memory.test.ts` missing dated audit-file failure. The exact focused test fails unchanged in the primary checkout.
- Coverage-write audit completed with no unresolved findings after adding private provider-file permission proof and exposing two fail-closed parser gaps. The parent hardened present-but-malformed optional state fields and strict RFC3339 timestamps; the auditor added regressions and finished with focused V8 coverage, 374 repo-tool tests, tools typecheck, and diff checks passing.
Completed: 2026-08-09
Completed: 2026-08-09
