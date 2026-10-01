# Use host-reachable Linq upstreams in composed local testing

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and protected invariants

Make the actual synthetic token-bridge journey reach its strict Linq HTTP upstream on macOS. Keep production provider interception, canonical container HTTPS URLs, sentinel credentials, bundle budgets, private worker authority, and cleanup unchanged.

## Cause and current owner

The scenario owner normalizes a Docker-only Linq hostname for Web alone. The host Worker retains that hostname. Two bounded composed runs on a97cb5d reached authenticated Web reads but no runtime send or cleanup HTTP request. An independent native Workerd probe reached the same synthetic server through loopback and failed Docker-alias DNS resolution. Linux deployment uses a different host mapping and its ordinary Linq delivery gate passed.

## Scope and design

Reuse the existing full-stack scenario host URL normalizer before starting both host processes. Preserve explicit Web overrides and the authoritative runtime-log database. No new runtime state, dependency, production logic, provider permissions, or deployment configuration. No member-visible UX or changelog change.

## Proof and tasks

1. Capture the generated harness environment and preserve canonical container URL/credential projection in focused tests.
2. Prove the generated host URL reaches a strict synthetic upstream through native Workerd, using no mocked fetch.
3. Run the unchanged full provider-egress-token-bridge journey with normal packaged assembly, guards, managed local Temporal, and synthetic providers.
4. Run focused tests, relevant typecheck, docs and complexity checks; review privacy and cleanup.
5. Obtain parent candidate review before a scoped wrapper commit and draft PR. Parent owns Ready, ReviewGPT, CI, merge and deploy.

## Risks and limits

Normalization must affect only the existing local HTTP Docker alias and retain custom paths. Native transport proof covers host reachability; only the unchanged composed journey proves runtime credentials and SDK delivery. No live provider outcome is claimed. Existing diagnostic artifacts remain in their original owned checkout.

## Verification

- Cloudflare typecheck passed. Four focused Node files / 48 tests passed: scenario environment, native Workerd HTTP, strict wire contract, and composed interception conformance.
- The unchanged full `pnpm hosted-local e2e provider-egress-token-bridge` passed one actual journey in 224.88 seconds on base 7949104 plus this helper fix. Normal assembly passed eight CLI parity probes; runner entry 70,738 B, static boot closure 2,026,958 B within 2,046,662 B, 21 of 24 chunks. Managed local Temporal and Cloudflare smoke passed. Final harness receipt status is complete; both exact synthetic databases were absent after teardown. No live provider or production authority was used.
- Reconciled parent-requested base ebb3ef30 by preserving this task's exact files, fast-forwarding, and restoring them. No conflicts. Both source/test helper files and new native proof were byte-identical afterward. Upstream changed CI/PostgreSQL tests and docs, with no packaged runtime or token-bridge source changes.
- Docs drift and gardening passed. Complexity guard passed with no production-source changes; the helper only reuses its existing branches at startup.
- Parent reviewed and approved all seven candidate files, privacy, preserved authority and complete proof. Close through the normal wrapper and open a draft PR; parent retains Ready, ReviewGPT, CI, merge and deploy ownership.
Completed: 2026-09-11
