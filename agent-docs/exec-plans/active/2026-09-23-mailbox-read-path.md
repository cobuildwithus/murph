# Remove unnecessary mailbox dependency loading and allowance reads

Status: active
Created: 2026-09-23

## Outcome and protected invariants

Reduce reply-path work without moving mailbox authority, caching permission, or
changing allowance, replay protection, write fences, delivery, or model input.

## Evidence and existing owners

The mailbox route statically reaches the Family billing workflow through the
usage allowance reader. That read needs only sponsorship tier, transition fields,
and billing-period metadata. It currently loads a broader Family presentation
projection and performs a separate billing-reference query. The allowance owner
can select those fields in one joined read without the mutation workflow import.

## Plan

1. Prove the existing import graph and serial read count with synthetic evidence.
2. Replace the broad projection and second read with one bounded joined query;
   retain active membership, active unsuspended group, ordering, tier validation,
   calendar fallback, and direct-paid precedence.
3. Measure dependency/startup changes and run focused billing, mailbox, and real
   PostgreSQL query-count/authority proof plus Web typecheck.
4. Complete parent review, ReviewGPT, exact-head CI, merge, and authorized deploy.

## Architecture and state

Keep allowance decisions in the existing allowance owner and plan constants in
billing-plans. No new service, protocol, configuration, cache, or persisted state.
The public mailbox response and Worker/container boundaries remain unchanged.

## Risks and proof

Nested Prisma relations must use one SQL statement; prove that against PostgreSQL.
Missing/invalid billing period metadata must retain calendar fallback. Inactive
membership, suspended/unpaid group, unknown tier, and direct-paid members must
retain their outcomes. Preserve the existing beneficiary lock and transaction.
A smaller synthetic import does not establish production cold-start savings.

## Deployment

Web-only compatible implementation change with no schema or wire changes. Old
and new Workers/containers use the same endpoint. Observe post-deploy timings;
retain all runtime authority and model rollout floors from current main.

## Progress

Implementation and parent review complete. The original code fails the new
Family workflow import guard and real-Postgres one-statement assertion; the
candidate passes. Five new PostgreSQL tests cover joined period reads, missing
billing-reference fallback, removed membership, unpaid group and suspension.
The schema itself rejects unknown membership tiers; the existing parser remains.

562 focused tests pass across allowance, Family mutations, mailbox routes,
callback query-load, crypto dependency loading and changelog rendering. Web typecheck and complexity
diff pass. Existing complexity hotspots are unchanged; the edited allowance
helper preserves its decisions and replaces two serial reads with one bounded
joined read. No external work or new pooled connection is added. Removing the Family workflow
edge also removes the signaling import cycle, so the request-time selection
factory is deleted in favor of its static projection.

A local esbuild CJS mailbox-route probe, using the Web tsconfig, react-server
condition and identical external Prisma/Google/Vercel/pg/Next/Stripe/Temporal
boundaries, decreases its graph from 904 to 347 modules and its output from
1,488,320 to 865,775 bytes. Ten alternating fresh Node 24 processes measure
median import time of 144.3 ms before and 77.6 ms after; evaluated CommonJS cache
entries decrease from 510 to 112. These are synthetic local probes, not Vercel
artifact measurements or a production speedup claim.

Product UX: Ready for review. Direct, Family and group allowance outcomes remain
unchanged; query count and dependency initialization shrink. No prompt, tool,
provider input or assistant behavior changes require a model journey. The
changelog states reduced preparation without a quantitative latency promise.
External review, exact-head CI and authorized deployment remain pending.
