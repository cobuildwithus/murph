# Hosted runtime progress alert

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Detect hosted runtimes whose durable mailbox work remains pending too long and
  email the existing operational-alert recipients before one poisoned item can
  silently block environment processing, device sync, patterns, or later work.

## Success criteria

- The existing five-minute Web cron detects active runtimes with live mailbox
  work whose clean-handling high-water remains behind for at least 15 minutes.
- The detector is error-code agnostic and covers both conversation and system
  lanes while excluding intentionally usage-blocked conversation work.
- One aggregate, identifier-free email is sent per continuous stall, with the
  existing Resend sender, recipients, quiet hours, pacing, retry idempotency,
  and concurrent-claim fencing.
- Recovery silently rearms the monitor so a later independent stall emails
  again.
- Focused monitor, query-summary, route, privacy, retry, and concurrency tests
  pass together with the Web typecheck.

## Scope

- In scope:
  - A bounded Web-owned mailbox-progress health read.
  - A second singleton incident row in the existing `HostedLinqAlert` table.
  - Reuse of the current operational Resend configuration and latency cron.
  - Focused tests and current architecture/reliability documentation.
- Out of scope:
  - Changes to Temporal, Cloudflare, mailbox processing, retry policy, device
    sync, or environment processing.
  - A new schema, scheduler, queue, runtime wake, or user-facing message.
  - Persisting or emailing member IDs, phone numbers, mailbox IDs, payloads, or
    exception text.

## Constraints

- PostgreSQL remains the mailbox and alert-state owner; the monitor is
  read-only apart from its existing operational-alert row.
- Runtime filtering reuses the canonical exact AI-access decision through its
  participant-aware batch form.
- Live-item filtering follows the mailbox owner's 14-day retention and expiry
  semantics.
- The monitor must fail visibly when enabled Resend configuration is incomplete
  and must not affect runtime work if email delivery fails.

## Risks and mitigations

1. Risk: long but healthy work could look stalled.
   Mitigation: use the clean-handling mailbox high-water and a 15-minute age
   boundary, not transient runner state or a single retry.
2. Risk: inactive or usage-blocked accounts could create permanent noise.
   Mitigation: filter through exact runtime AI access and suppress conversation
   heads that have a valid usage-denial stamp with no later execution evidence;
   resumed work ages from its first post-denial staging, provider, delivery, or
   durable consumption milestone.
3. Risk: overlapping cron invocations or ambiguous Resend outcomes could spam.
   Mitigation: reuse the latency monitor's compare-and-set incident lifecycle,
   send lease, stable idempotency, quiet hours, and paced retries.
4. Risk: operational evidence could disclose customer data.
   Mitigation: persist and email aggregate lane counts, pending counts, ages,
   thresholds, and truncation only.
5. Risk: one monitor failure could detach its still-running sibling when the
   serverless request returns.
   Mitigation: await both monitor outcomes before propagating either failure,
   preserving a visible error response without stranding either incident owner.

## Tasks

1. Extract the existing reusable Resend incident lifecycle without changing
   latency-monitor behavior.
2. Add the bounded mailbox-progress query, aggregate health, and alert copy.
3. Run both monitors from the existing authenticated five-minute cron.
4. Add focused regression and privacy/concurrency coverage.
5. Update durable Web and architecture/reliability contracts.
6. Run verification and required ReviewGPT/CI gates, then publish the PR.

## Verification

- Commands to run:
  - Focused Vitest files for latency, progress, and cron monitors.
  - `pnpm --dir apps/web typecheck`.
  - `git diff --check` and privacy/path inspection.
  - Preliminary `completion-specialists` and final ReviewGPT gates on the exact
    pushed candidate while required PR CI runs.
- Results so far:
  - Focused latency/progress/cron Vitest proof passed after review remediation:
    3 files, 55 tests; the opt-in PostgreSQL file skipped in the ordinary run.
  - The dedicated local-PostgreSQL boundary passed against all 172 production
    migrations: 1 file, 1 rollback-only test. It covers exact personal/group
    authority, ineligible participant variants, denial/resume chronology,
    truncation, and exclusions ahead of the cap.
  - The production migration/schedule guard passed: 1 file, 53 tests.
  - Focused ESLint, Web and Cloudflare typechecks, and `git diff --check`
    passed. The runner bundle also assembled successfully.
  - A read-only aggregate production query confirmed that the bounded scan
    detects current alertable stalls and completed in about 36 ms; no direct
    identifiers or row payloads were persisted in task artifacts.
  - Preliminary specialists and final ReviewGPT round 1 found access-authority,
    post-denial timing, production-fidelity, full-stack coverage, and sibling
    request-lifetime gaps. All findings were accepted and corrected. Final
    ReviewGPT round 2 then completed a fresh full-snapshot audit of the
    corrected pushed head and returned `ROUND_OUTCOME: PASS` with no findings,
    explicitly verifying every correction and the shared incident lifecycle.
  - The hosted-local command reached and passed runner-bundle assembly, then
    stopped before service launch because no Docker executable is installed in
    this environment. The scenario is typechecked and remains the CI-owned
    full-stack proof.
  - The parent reapplied the product-experience lens to the corrected pushed
    head. Verdict: `NO FINDINGS`. The smallest complete experience remains the
    existing five-minute cron plus one privacy-safe aggregate email, inherited
    quiet-hours/retry behavior, and silent recovery/rearm. The only material
    evidence gap is local execution of the Docker-backed hosted-local scenario;
    the dedicated real-PostgreSQL proof and production read cover the database
    path directly.
  - Parent final review found no remaining correctness, privacy, ownership, or
    handoff gap. The corrected head is mergeable with current `main` and all
    exact-head public PR checks are green, including the 9,481-test Web app
    verification shard.
Completed: 2026-08-10
