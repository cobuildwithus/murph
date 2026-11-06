# Recover inactive runtime owners during retention admission

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Recover failed runtime ownership when maintenance requests a different processing mode, without interrupting live or uncertain work.

## Scope and constraints

Use the existing bounded native liveness probe and exact retirement/release path. Preserve startup grace, canonical claim admission, completion receipts, and foreground priority. No scheduler, schema, retry policy, or private worker changes.

## Product UX

Outcome: background work can recover from a failed invocation without waiting for unrelated foreground activity.
Reaches: inactive runtime owners confronted by due retention work; live, uncertain, mismatched, and starting owners retain their existing protection.
Proof: regressions through the production processing adapter, relevant liveness/completion suites, and Cloudflare typecheck. Production rollout remains separate from local proof.

## Tasks

1. Reproduce retention admission stuck behind an inactive incompatible owner.
2. Probe liveness before returning a mode conflict and reuse existing recovery.
3. Verify inactive recovery and protected-owner cases; review and commit the scoped change.

## Verification

- Before the fix, both inactive-owner recovery regressions returned retry instead of starting a successor.
- After the fix: 56 processing/completion tests pass; live foreground, mismatched, unknown, and starting ownership remain protected.
- Cloudflare typecheck passes after the existing Prisma generation prerequisite.
- Complexity diff passes: no added debt or hotspots; maximum remains 19.
- Changelog generation and all 10 archive-render tests pass.
- Diff and privacy review pass. Local proof is complete; PR review, CI, and production deployment remain separate gates.

## Changelog

Updated `2026-09-30/background-sync-recovery` with the member-visible recovery outcome. No rendering changes.
Completed: 2026-09-30
