# Custom connections Web authority and OAuth

Status: blocked
Created: 2026-11-15
Updated: 2026-11-15

## Goal and scope

Implement Part A of the approved custom-connections design. Web owns remote
URLs, OAuth, encrypted credentials, approval snapshots and gateway authority.
Keep the exact Settings, manifest and versioned MCP contracts. Runtime and
Cloudflare implementation belong to the separate Part B branch. No push,
production access, deployment or PR creation is authorized.

## Product UX

Allowlisted personal members add an HTTPS service, sign in if required, and
choose read-only tools. All tools begin off. Changed approved definitions need
another approval. Off, removed, suspended and stale mounts refuse execution.
Recovery directs the member to Settings without exposing remote credentials.
The brief says the UI is being built against the shared APIs; this work owns
those APIs and their authentication boundaries.

## Implementation and proof

1. Add bounded connection/pending persistence and account cascades.
2. Implement pinned outbound transport and approved catalog change detection.
3. Compose SDK OAuth with frozen discovery, browser binding and refresh leases.
4. Add session/CSRF Settings APIs and signed, fenced manifest/MCP routes.
5. Test transport, OAuth races, gateway admission and safe error projections;
   run focused Web tests, Prisma validation, typecheck and complexity review.
6. Commit stable points and write the requested external implementation report.

## Constraints and current evidence

SDK client/server versions are exactly 2.4.0. Existing secure-box, app session,
CSRF and signed callback owners are reused. Provider and crypto I/O stay outside
short database transactions. Remote errors never become public response text.

Dependency installation (including lockfile-only) currently fails with EPERM
when pnpm registers the project in its shared store, outside session write
permissions. Published SDK declarations can be inspected from temporary
storage. No alternative store, vendored code or dependency patches are used.

## Verification status

Web backend and focused proof are implemented. The temporary published-SDK
resolution lane passes 100 protocol/authority/retention tests; the separate
secure-box binding test and exact PostgreSQL migration/cascade test pass.
Fallback typecheck, focused lint, complexity, docs drift and gardening pass.
The exact package pins and registry-integrity lock entries are prepared.

Normal install and typecheck are blocked by shared pnpm-store write permissions.
The first scoped commit failed in the hook installer because the shared Git
storage-guard lock is not writable. The cross-connection PostgreSQL test cannot
create its isolated schema with the available local role. The requested external
report directory is also not writable. A detailed report, commands, exit codes
and missing proof are preserved at `/private/tmp/report-web.md`.

The task remains active and blocked, not completed. Resume with the necessary
filesystem access, validate the frozen install with ordinary Web checks, finish
cross-instance and live transport proof, and commit through the normal helper.
No push, PR, deployment or production operation occurred. No Part B source was
changed. Product walkthrough: Hold pending composed proof and the separate UI.

