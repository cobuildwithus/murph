# Reuse public CI builds and checks

Status: active
Created: 2026-10-01
Updated: 2026-10-01

## Goal

Reduce paid integration compute by producing reusable public-only build outputs on standard public GitHub runners. Preserve exact-candidate release authority and all existing runtime proof.

## Success criteria

- Public production admission publishes a versioned, exact-commit integration Web build before private proof starts.
- Private consumers validate the producer, source, attempt, and artifact contract before reusing the output; unavailable compatible output retains the existing build path.
- No private source, runtime extensions, credentials, or production data enters public artifacts.
- Duplicate private predeploy builds collapse to one producer with required consumers.
- Focused workflow and artifact-boundary tests, relevant typechecks, required review, and exact-head CI pass.

## Scope

Public build producer and its proof; private consumer, duplicated checks/builds, and verification cancellation. The private repository owns its implementation and cost evidence. Private worker tests and deployment authority remain private. No production deployment is part of this change.

## Constraints

Use existing Actions artifacts, exact source identities, and the current build commands. Never replace a proof with an unrelated successful check. Do not weaken source, environment, or release guards for savings.

## Risks and mitigations

- Build-setting drift: use the integration build environment and a versioned artifact contract.
- Untrusted or stale output: require the owned main-push producer and exact source/attempt; validate metadata before reuse.
- Cross-repository download availability: preserve the existing private build fallback without waiting on a paid runner.
- Producer-first rollout: old public revisions continue using the private fallback; the public producer is additive.

## Tasks

1. Trace public versus private build inputs and confirm public-only ownership.
2. Implement public artifact production and private validation/reuse.
3. Consolidate private predeploy runner builds and assess public-check equivalence.
4. Assess the independent Opus cost audit and implement substantiated additional savings.
5. Run focused proof, review complete diffs, and complete repository delivery gates.

## Decisions

- Standard public Actions are the public build owner; private code and integration remain in the private repository.
- Artifact reuse is an optimization, never release authorization.

## Verification

Exercise actual workflow declarations and artifact validation with mismatched source, attempts, producer, incomplete runs, missing output, and successful reuse. Run focused Node/Vitest tests and applicable TypeScript checks; retain exact-head hosted proof.

## Implementation evidence

- Public producer and private consumer are implemented with exact attempt and
  digest validation, archive inventory checks, and nonblocking private fallback.
- Private predeploy bundle production is shared across all five E2E consumers;
  PR verification cancels superseded runs while main remains commit-specific.
- Claude Opus 5.5 independently audited both repositories. Additional Cloudflare
  check reuse requires proving equivalence after private materialization and is
  deferred; existing release checks remain intact.
- Focused producer/controller tests: 85 passing. Public tooling typecheck and
  complexity guard pass (no changed function exceeds 20).
- Private full verification and hosted artifact-token proof are pending.
- Internal CI-only change: no member-facing changelog entry is warranted.
