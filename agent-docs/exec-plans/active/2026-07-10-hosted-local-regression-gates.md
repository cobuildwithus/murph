# Hosted Local Regression Gates

## Goal

Land the recurring-regression coverage identified across the latest 300 merged PRs as production-faithful hosted-local end-to-end scenarios, promote existing ungated proof where it already owns the behavior, and make the critical hosted-local suites stable required PR checks.

## Constraints

- Keep the implementation test-, harness-, workflow-, and documentation-owned unless a scenario proves a missing production seam that cannot be controlled at an existing external boundary.
- Reuse the existing hosted-local stack, scripted Responses API, provider stubs, test controls, and shared runner bundle; do not add another supervisor, state owner, queue, or generic fault framework.
- Inject failures only at existing external or test-control boundaries and use deterministic barriers instead of wall-clock sleeps.
- Preserve provider, member, group, approval, usage, device, and workspace authority boundaries; fixtures and artifacts must contain only synthetic identifiers and redacted state.
- Coordinate overlap with the active hosted Codex image/media E2E and hosted-local harness hardening lanes without copying their uncommitted work.
- Keep required check names stable through aggregator jobs and update the durable testing/verification docs truthfully.
- Complete specialist audits, full required verification, PR publication, and the ReviewGPT PR loop to zero accepted findings.

## Plan

1. Inventory existing scenario helpers, fault controls, testkit routes, registered manual scenarios, and workflow matrix shape; map each requested regression to the smallest existing owner boundary.
2. Add shared deterministic test controls only where multiple scenarios need the same boundary, then implement the runtime durability scenarios: lost canonical acknowledgement, foreground-over-maintenance ordering, checkpoint conversation-ahead, retryable outbox restart, and failed snapshot publication fallback.
3. Implement messaging and sensitive-effect scenarios: group route drift, vault-file approval resume, ambiguous usage-limit notice, home-line reroute/retry, unknown first-contact admission, Retell result roundtrip, and Family-sponsored chat lifecycle.
4. Implement device/media/computer scenarios: Junction retry semantic integrity, generated-image capture roundtrip, computer handoff roundtrip, and device-activity experiment adherence.
5. Register every genuinely new scenario, promote existing authoritative scenarios instead of duplicating them, repair the audio scenario wiring, and add stable required aggregate jobs to the hosted and device-sync workflows.
6. Update durable verification/testing documentation, run focused hosted-local proofs and the full acceptance lane, then complete required security/privacy and coverage-write audits plus the parent final review.
7. Close the plan with a scoped commit, push and open a draft PR with the required intent contract, run ReviewGPT rounds to zero accepted findings in parallel with CI, resolve accepted findings, and prove the final head is green and mergeable.

## Verification

- Focused Vitest for each new or changed scenario/helper.
- `pnpm test:diff` for touched harness, Cloudflare, web, workflow, and documentation surfaces when truthful.
- Direct `pnpm hosted-local e2e <scenario> --no-bundle` or the canonical equivalent for every newly gated scenario after one shared bundle build.
- `pnpm verify:acceptance`.
- Workflow syntax/readback and stable required-check aggregation proof.
- Required `security-privacy-review` and `coverage-write` audit passes.
- Parent-owned full diff/call-path review.
- PR ReviewGPT loop to zero accepted findings and green PR CI on the final pushed head.

## State

Active. All recurring-regression scenarios, shared deterministic controls,
registry entries, workflow matrix legs, and stable aggregate check jobs are
implemented. Focused typechecks and helper tests are green. The task branch is
being rebased onto the latest `main` before the full acceptance, audit, PR,
ReviewGPT, hosted CI, required-check, and merge landing loop. Direct local
hosted-stack execution remains deferred while unrelated local sessions own
active hosted processes; the isolated CI matrix is the authoritative runtime
proof if that ownership conflict remains.
