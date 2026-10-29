# Resolve release audit correctness and recovery findings

Status: completed
Created: 2026-10-28
Updated: 2026-10-28

## Goal

- Resolve the six confirmed release findings and the two follow-ups while preserving existing authority, privacy, and canonical state owners.

## Success criteria

- Regression proof for authenticated deletion retry, interrupted JSONL append, game grace timing, concurrent rematches, retained image visibility, active Home games, and cancellable retry discovery without a duplicate history scan.
- Patched Next.js, Better Auth and HTTP dependencies and successful focused tests, relevant typechecks, build, parent review, and scoped commit.
- Investigate failed canary evidence and distinguish source fixes from production verification that requires deployment.

## Scope

- In scope: reviewed source boundaries, regression coverage, dependency patch, durable owner documentation, public-safe changelog, and read-only canary investigation.
- Out of scope: deployment, production mutations, sending member messages, broad runtime refactors.

## Constraints

- Technical constraints: retain suspension for runtime access; reuse game pair locks; keep provider and KMS work outside transactions; preserve bounded datastore work; preserve canonical recovery evidence.
- Product/process constraints: synthetic proof only; no private production rows or local identifiers in artifacts; isolated task branch.

## Risks and mitigations

1. Deletion retry could weaken suspension. Expose the exception only to authenticated account deletion and prove ordinary access remains denied.
2. Query bounds could discard valid results. Apply visibility and active-state selection before limits; test beyond former cutoffs.
3. Retry optimization could change reply policy. Preserve terminal evidence, cursor ordering, and same-chat matching.

## Tasks

1. Fix deletion retry and patch Next.js.
2. Repair partial append rollback, with injected I/O failures.
3. Repair game grace, rematch race, media authorization, and Home selection.
4. Reuse the retention snapshot for stale-retry discovery and propagate cancellation.
5. Investigate canaries, update owners/changelog, verify, review, and commit.

## Decisions

- Existing owners retain authoritative state; no new scheduler or duplicate cleanup owner.
- Product UX patch: Outcome: truthful recovery and preserved game history/scoring. Reaches: deletion after provider failure; offline posting; crossed rematches; reused media; older live games. Proof: composed authentication/route tests, real PostgreSQL race and selection tests, canonical fault injection, and unchanged ordinary-denial cases.

## Verification

- Focused Web, Core, Assistant Runtime/Engine tests; relevant package and Web typechecks; Web build; dependency audit/policy; workspace boundary/cycle and complexity checks.
- Each new regression must fail before its correction and pass afterward where practical. Operational canary status is reported separately from local proof.


## Implementation and evidence

- Deletion uses a purpose-specific authenticated session read. A real PostgreSQL
  encrypted browser-session test reaches the route twice across persisted
  suspension; ordinary access stays denied and deleted/revoked sessions fail.
  The service's provider-failure ordering has separate focused coverage.
- JSONL rollback restores partially written prepared appends, verifies the
  preimage and payload prefix, preserves recovery evidence on conflict or
  restore failure, and permits a subsequent ordinary append.
- Game proof uses the real migrated PostgreSQL schema: both same-player and
  opposite-player simultaneous rematches produce one game; fifty-one later
  invitations cannot hide an older live game; six later withdrawn references
  cannot hide visible reused media. Stranger and reported-entry denial remain.
  Grace bounds use local day instants, preserving DST and clock slack.
- Retry selection reuses the existing retention snapshot and groups only
  relevant later member inputs. There is no new persisted state. Retention
  still scans the store; this removes the additional retry scan and nested
  pending-by-history search, rather than claiming constant-time maintenance.
  Tests prove same-chat evidence, system exclusion, newer unanswered messages,
  one history listing, and cancellation before/during listing.
- Next.js and its lint plugin are 16.4.3; the unnecessary homepage Server
  Action is a server-only helper. Better Auth is 1.7.7 and Undici is 7.30.1.
  Compatible Zod 4 and body-parser overrides include their security patches.
  Existing supply-chain age and registry checks remain enabled.
- Red/green proof: the original source fails six focused Web/game regressions,
  three partial-write regressions and three retry-scan/cancellation regressions.
  Restoring the fixes makes the focused suites pass.
- Final focused totals: Web/auth/game/changelog 538 tests; Cloudflare HTTP
  transport 77; Core 49; Assistant Runtime 102.
- Typechecks: Web (inside the production build), Cloudflare, Core and Assistant
  Runtime pass. The isolated database applied all 263 repository migrations.
- Production-format Web build passes with synthetic hosted-local environment;
  trace checks pass and four relocated emitted OG routes render. Its server
  reference manifest contains zero Server Actions.
- Dependency policy, workspace boundaries, package cycles, docs drift,
  whitespace and cyclomatic complexity checks pass. Existing unchanged
  hotspots remain; Core complexity debt decreases by four.
- No model prompt, tools, selected message policy or foreground provider input
  changed. Deterministic composition proves retry equivalence; no live model
  or production message was needed for this optimization.
- Parent review: source, proof, lockfile, authority and state owners reviewed.
  Product UX verdict: Ready for the covered local journeys. Changelog uses
  existing archive rendering; fragment/render proof passes. No new abstraction,
  scheduler, migration or durable index was introduced.
- Existing Frog entries cover generated prerequisites, database constraints
  and local test invocation; no new repository workaround required an entry.

## Release verification limits

- This task produces a local scoped commit. It does not deploy, rerun production
  canaries, mutate production, or claim exact-head CI / final PR review.
- Read-only canary investigation: iOS run 40640418959 reached app launch and
  failed initial OTP; Android run 40643304173 failed its Gradle infrastructure
  stage. The Linq canary exceeded its response-time budget. These need successful
  live proof through their existing owners before production sign-off.
- Audit after patching: zero critical, two high, 27 moderate and five low.
  Remaining high paths are Prisma configuration's deepmerge-ts 7 and the
  Cloudflare test worker's Zod 3. Their advertised fixes cross major versions;
  they were not forced into incompatible tooling. This is not a clean audit
  or a claim that every advisory is exploitable in production.
- Deletion recovery requires the existing valid authenticated session; this
  change does not grant access through expired/revoked sessions or reopen the
  suspended account's ordinary dashboard/runtime.
- New changelog source-PR arrays stay empty until this local candidate receives
  a PR number. No external review or CI result is fabricated.
Completed: 2026-10-28
