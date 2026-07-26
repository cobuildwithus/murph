# Durable account-deletion cleanup and bounded participant authority

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Preserve durable retry ownership for external account-data deletion after canonical account removal, and prevent stale Linq participant rows from granting indefinite hosted-group authority.
- Integrate the supplied patch by current behavioral intent only; retain the independently landed Telegram group-speaker attribution already present on `main`.

## Success criteria

- Canonical account deletion cannot remove the last durable identifiers needed to finish Cloudflare, Privy, and Stripe cleanup.
- External cleanup retries are idempotent, bounded, encrypted at rest, owned by an existing scheduled process, and removed only after every required target converges.
- The deletion response and Settings state never claim complete cleanup while any external target remains pending or unconfigured.
- Participant-derived thread-container access, AI usage, and newsletter eligibility share one bounded current-membership predicate.
- A current authenticated Linq inbound may refresh only an already-authoritative participant relation and cannot create authority, reverse a newer removal, move evidence backward, or extend authority with a future timestamp.
- Focused regression proof, canonical acceptance, local product review, preliminary specialist ReviewGPT, parent final review, final ReviewGPT, and CI all complete with no unresolved accepted findings.

## Scope

- In scope: hosted account-deletion state and retention retry ownership; Cloudflare deletion idempotency; bounded thread-container participant authority and current-inbound refresh; truthful Settings cleanup state; migrations, tests, and current owner docs required by those changes.
- Out of scope: the supplied Telegram attribution hunks already superseded by current `main`; unrelated account lifecycle, roster redesign, new schedulers, provider pagination, or broad group-access refactors.

## Constraints

- Prefer deletion, derivation, and existing owners. Add no dependency, service, queue, or scheduler.
- Any deletion receipt must be foreign-key-free, minimal, encrypted before first durable write, explicitly retained, indexed for bounded work, and safe after the member row is gone.
- Participant display identity is never authorization. Only server-resolved current relationships can affect access.
- Preserve authorized account deletion and current-inbound group conversation flows; safety fixes may not silently disable them.
- Treat the supplied patch as untrusted behavioral intent and inspect every compatible hunk before applying or rewriting it.

## Risks and mitigations

1. Risk: a cleanup receipt becomes a second account-data owner or retains identifiers indefinitely.
   Mitigation: store only target identifiers required for deletion, track per-target convergence, encrypt the payload with receipt-bound AAD, retry through the existing retention owner, and delete the receipt at terminal success.
2. Risk: crash or lease loss causes duplicate external effects or false completion.
   Mitigation: make each target deletion idempotent, persist target completion independently, use a bounded compare-and-set lease, and delete the receipt only while exact ownership is still held.
3. Risk: a participant lease blocks legitimate large-group use or lets delayed/future input extend access.
   Mitigation: share one predicate, refresh only existing non-removed relations from authenticated ingress, clamp provider occurrence time to server time, and update monotonically without clearing a newer removal.
4. Risk: the older patch overwrites newer Telegram, retention, or account-lifecycle architecture.
   Mitigation: port behavior by owner against current `main`, omit already-landed Telegram hunks, and run full base-to-head review and cross-owner verification.
5. Risk: deploy skew lets an older Worker report SQL deletion as full Durable Object erasure.
   Mitigation: require explicit `deleteAllCompleted` evidence, keep legacy responses pending, deploy Cloudflare before web, and document the rollback floor.
6. Risk: a slow provider leaves the deleted member waiting or monopolizes the hourly sweep.
   Mitigation: bound immediate and retry target attempts, retain the receipt on timeout, and process retry receipts with small fixed concurrency.

## Tasks

1. Trace current deletion, retention, Linq ingress, participant access, AI usage, and newsletter owners; compare each supplied hunk against current code.
2. Implement the smallest compatible durable cleanup receipt and bounded participant-authority primitives with focused migration and behavior tests.
3. Update current owner docs and direct UI state proof where behavior changes.
4. Run canonical verification and required local product/rendered review; resolve accepted findings.
5. Commit, push, open the PR, run preliminary specialist ReviewGPT, parent final review, final ReviewGPT concurrently with CI, and resolve the loop to a clean exact head.
6. Close this plan and remove its coordination-ledger row through `scripts/finish-task`.

## Decisions

- Do not apply the supplied patch wholesale because it targets an older repository snapshot and conflicts with current owners.
- Omit Telegram attribution changes from this PR because current `main` already preserves provider-authenticated group sender identity through the mailbox, actor, shared-read, and prompt boundaries with focused tests.
- Reuse the existing hosted retention cron as the sole account-deletion cleanup retry owner.
- Accept the product-review deploy-skew and provider-deadline findings; resolve them within the existing Worker response and receipt state machine rather than adding another cleanup owner.

## Verification

- Supplied patch provenance:
  - The uploaded patch artifact matched the SHA-256 recorded in the source thread.
  - Every retained behavior was reconciled against current owners on `main`; already-landed Telegram attribution was omitted.
- Local focused proof:
  - Prisma generation and schema validation passed.
  - The isolated worktree database accepted the expanded schema.
  - Typechecks passed for `apps/web`, `apps/cloudflare`, and `packages/cloudflare-hosted-control`.
  - Expanded focused suites passed for deletion receipts, retention retry, truthful deletion status, participant leases and ingress renewal, the Cloudflare deletion contract, and the shared control client.
  - The complete Linq dispatch suite passed after adding the new participant delegate to its existing Prisma fixture.
  - Full web lint passed with zero errors and fourteen unrelated or pre-existing warnings.
- Product-experience review:
  - Accepted and fixed the legacy-Worker false-completion seam by requiring explicit Durable Object `deleteAll` evidence.
  - Accepted and fixed unbounded provider cleanup by adding immediate/retry attempt budgets and fixed retry-batch concurrency.
  - The in-app Browser was unavailable, so rendered desktop/mobile proof could not be captured. The reusable pending and completed states are registered in `/design?tab=components` and `/design?tab=sections`, and component tests cover both states.
  - The configured Claude visual review could not run because its provider account had no remaining credits.
- Canonical verification:
  - `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/web apps/cloudflare packages/cloudflare-hosted-control` passed in Blacksmith Testbox `tbx_01kyep30qdg9s664ekjtzwaw4g` (GitHub Actions run `30193324227`).
  - `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed in Blacksmith Testbox `tbx_01kyep7a9s43908gvvt3m0n14b` (GitHub Actions run `30193396991`).
  - The successful diff gate included 6,651 web tests, 1,930 Cloudflare tests, 46 shared-control tests, lint, typechecks, dev smoke, and the production web build.
- Remaining completion gates:
  - preliminary `completion-specialists` ReviewGPT on the exact pushed PR head;
  - parent final review and any required remediation verification;
  - final ReviewGPT plus green PR CI on the immutable final head;
  - clean merge proof against the latest base.
