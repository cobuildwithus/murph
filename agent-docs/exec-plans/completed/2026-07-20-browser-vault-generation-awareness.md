# Browser-vault generation-aware freshness

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Make browser-vault freshness reject replicas produced by an older projection
  generation so newly shipped fields do not remain hidden behind the ordinary
  24-hour age window.

## Success criteria

- Every newly generated browser-vault replica and published replica ref carries
  one shared projection-generation value.
- Legacy or mismatched refs remain readable but are assessed as stale and cause
  Web to request the existing low-priority forced refresh path.
- Current-generation refs retain the existing source-hash and maximum-age
  freshness behavior.
- Worker/runner and Web deploy skew remains fail-soft: old replicas can still be
  served while refresh retries until the new runner generation converges.
- Focused shared-package, Web, Cloudflare, and compatibility tests pass, followed
  by the required completion audits, PR CI, and ReviewGPT gate.

## Scope

- In scope:
  - shared browser-replica schema/generation constants;
  - replica payload and hosted replica-ref parsing/propagation;
  - freshness assessment and browser-session refresh behavior;
  - encrypted replica/ref consistency checks;
  - focused compatibility, Web, runtime, and Cloudflare tests;
  - durable architecture/runtime-protocol guidance for generation bumps and
    deployment skew.
- Out of scope:
  - a user- or assistant-facing manual refresh command;
  - a new queue, scheduler, database column, migration, or canonical health
    record;
  - changing the 24-hour maximum age for current-generation replicas;
  - repairing or interpreting member health data.

## Constraints

- Technical constraints:
  - preserve legacy replica readability and stale-while-revalidate behavior;
  - use the existing browser-session system-mailbox refresh path;
  - keep the generation marker metadata-only and bind it to the encrypted
    replica through the existing data-version derivation;
  - preserve foreground priority and active write-fence publication rules.
- Product/process constraints:
  - preserve unrelated work and active ledger lanes;
  - work only in `/private/tmp/murph-browser-replica-generation-version` on
    `codex/browser-replica-generation-version`;
  - do not expose member identifiers or private health data in repository or PR
    artifacts.

## Risks and mitigations

1. Risk: Web deploys before the new Worker/runner bundle and repeatedly sees
   legacy refs.
   Mitigation: continue serving the readable old replica, dedupe refresh handoff,
   and document immediate Worker/container convergence after Web deployment.
2. Risk: a new Worker receives a replica from a still-warm old runner.
   Mitigation: treat the missing generation as legacy, publish it readably, and
   keep it stale until an immediate container rollout produces the current
   generation.
3. Risk: future projection changes forget to invalidate older replicas.
   Mitigation: define one shared current-generation constant, hash the marker as
   replica content, and document that projection-shape or interpretation changes
   require a bump plus compatibility proof.

## Tasks

1. Map the current payload, ref, parser, freshness, encryption, and Web-session
   ownership path.
2. Add the shared generation contract and legacy-compatible parsing.
3. Make freshness and loader/ref equality generation-aware.
4. Add focused tests for legacy, current, mismatched, encrypted, and deploy-skew
   behavior and update durable docs.
5. Run verification, required audits, parent final review, scoped commit, PR CI,
   and ReviewGPT to completion.

## Decisions

- Keep the existing schema identifier stable and add an optional integer
  `generation` marker. Absence means a readable legacy replica, never a current
  one.
- Put the schema and current generation constants in the lower shared contracts
  package already consumed by both query and hosted execution.
- Do not add a conversational force-refresh tool. Once the fixed Web and runtime
  are deployed, opening an affected dashboard page is the truthful recovery
  trigger.

## Verification

- Focused query, hosted-execution, assistant-runtime, Cloudflare, and Web suites
  passed, including current, missing, mismatched, encrypted, session-route, and
  browser-consumer generation behavior.
- Targeted typechecks passed for contracts, query, hosted-execution,
  assistant-runtime, Cloudflare, and Web.
- The direct production-code scenario emitted generation `1`, assessed the
  current ref as fresh, and assessed the same generation-less ref as stale with
  `generation_mismatch` and refresh requested.
- The required coverage-write audit added one legacy Web-consumer regression:
  matching generation-less payload/ref pairs stay readable while stale and
  refresh-pending. Its focused 37-test Web suite passed.
- Diff-aware verification passed all mapped typechecks and the affected
  contracts, assistant CLI, assistant engine, assistant runtime, assistantd,
  CLI, core, device-sync, health-commons, and hosted-execution suites. Its broad
  hosted-local-harness fanout exposed a pre-existing artifact-order gap:
  `build:test-runtime:prepared` does not build the required
  `packages/assistant-runtime/dist`. After the prescribed owner build, the
  isolated harness passed 24 files and 406 tests with one skipped.
- `git diff --check` and task-diff privacy scans passed. Remaining PR work is
  the pushed-head ReviewGPT loop, GitHub CI, and clean mergeability proof.

Completed: 2026-07-20
Completed: 2026-07-20
