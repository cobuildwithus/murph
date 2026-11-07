# Restore native base image publication

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Restore the canonical protected-main native base image publication so deployment integration gates can reuse their existing verified source-fingerprint cache.

## Owner and evidence

The publisher workflow delegates to the app-owned base image helper and checksum-pinned Dockerfile. The publisher uniquely overrides native compilation to four jobs; the Dockerfile default is two. Current-source latency run 39446556441 completed with two jobs: native compilation took 59m37s, and the unchanged benchmark passed. Its Dockerfile and native patch have exactly the same fingerprint as the failed publisher and this candidate. Failed publisher attempts ended in runner shutdown or lost communication before publication. Memory exhaustion is not established because those attempts retained no resource samples.

## Scope and protected invariants

Remove the divergent publisher override using the ReviewGPT-authored correction. Preserve native source, image fingerprints, publication permissions, protected-main admission, build timeouts, production forced-source rebuilds, all CI/E2E/smoke gates, and existing deployment authority. No product, schema, credential, recovery, or provider changes. Do not claim a hardware root cause from cancellation alone.

## Plan

1. ReviewGPT authors the smallest justified mitigation or necessary targeted diagnostic.
2. Prove the actual workflow/build argument composition before and after the change; run relevant tests and typecheck. Inspect scope, privacy, and source-fingerprint preservation.
3. Push a scoped draft PR, make the stable candidate Ready, and run final ReviewGPT concurrently with exact-head required CI.
4. After green gates, merge and verify the protected-main publisher actually completes and the source-fingerprinted image is available anonymously.
5. Use the canonical Web admission and Cloudflare release workflows with all gates. Verify actual serving revisions and outcomes. Preserve separate observation and infrastructure blockers honestly.

## Verification

Baseline: 20 base-image and container-contract tests pass. Existing successful two-job build receipts establish that configuration is viable, not that the failed publisher exhausted memory. Anonymous registry inspection currently returns manifest unknown for the exact source fingerprint. Final proof must include successful native publication; unit tests alone cannot prove host stability.

## Risks and decisions

The mitigation may not resolve external runner termination; a new failure requires its own evidence instead of blind retries. Keep source-fingerprint inputs byte-identical. Reuse existing Frog issue 4227 for the matching compilation failure family. Internal workflow changes do not require a member changelog or assistant journey.

## Implementation evidence

- ReviewGPT authored the two-line workflow deletion and one composed regression in the existing base-image test owner. The test runs the checked-in workflow command through the actual package entrypoint and helper with only Docker replaced by a synthetic spy; the actual Dockerfile Cargo command receives the resulting job value.
- Tests-only reproduction fails with expected 2, received 4; the other nine tests pass. Applying the workflow deletion yields 21 passing base-image and container-contract tests.
- Cloudflare typecheck passes after canonical Prisma generation. The complexity guard passes with no authored production TypeScript changes. Parent review confirms no new build owner, dependency, source pin, timeout, permission or release-gate change.
- Native source fingerprint remains cede4ab6368c3d0a4abba0e98b478ac5d12cf7168a71607a7c6e334128eea25b. Local Docker is unavailable; real protected Linux publication remains required and unresolved.
- Implementation and parent candidate review are complete. Final ReviewGPT, exact-head CI, merge, actual publication, deployment, and observation remain separate delivery gates owned by this PR and sweep. This completed implementation record does not claim those outcomes.
- Before merging this publisher correction, land the independently reviewed OAuth callback drain compatibility correction: automatic Web promotion must retain the consumer used by the actual serving legacy runtime.
Completed: 2026-10-20
