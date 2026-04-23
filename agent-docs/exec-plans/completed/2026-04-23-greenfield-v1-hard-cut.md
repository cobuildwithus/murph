# Greenfield V1 First Cleanup Batch

## Goal

Land the first safe cleanup batch toward a canonical greenfield v1 before public 1.0. Success for this plan means the release line is reset to 1.0.0, the touched Murph-owned version seams start at v1, selected old compatibility readers and aliases are removed where the current checkout can safely own them, and directly coupled docs/tests describe the current design.

## Assumptions

- No deployed production state or user data must be preserved.
- External API version names are not Murph schema versions and are exempt: provider APIs, GitHub Actions versions, `zod/v4`, and package import paths such as `pdfjs-dist/legacy`.
- This plan intentionally avoids overwriting unrelated dirty work. The current checkout has active overlapping rows in Cloudflare runtime/deploy, hosted assistant provider config, hosted web, assistant runtime, and CLI cleanup.

## Canonical V1 Policy

- Murph-owned schema strings end in `.v1`.
- Murph-owned numeric schema/store/current-version constants use `1`.
- Workspace package versions should converge on `1.0.0` before release.
- Hosted execution vocabulary is ingress/run/timer, not wake/nudge.
- Readers should fail closed on old internal shapes instead of silently adapting them.
- Prisma starts from one baseline migration for hosted v1.
- Docs and tests should assert canonical behavior, not historical migration paths.

## Batch Scope

This plan owns the first batch only:

1. Coordination and safe-slice split.
   - Register this plan and a ledger row.
   - Have five high-reasoning subagents work in disjoint slices.
   - Avoid currently dirty files unless the subagent's output is review-only or the overlap is explicitly integrated.

2. Version and schema reset.
   - Normalize internal v2/v5 seams, including hosted email runtime state, assistant cron runtime state, research orchestrator schema, and experiment protocol contract version.
   - Reset workspace package versions to `1.0.0`.

3. Compatibility reader removal.
   - Remove selected no-op CLI/script flags and stale old-shape readers that only exist for non-existent pre-v1 state.

4. Hosted side-effect naming cleanup.
   - Remove generic hosted side-effect aliases where the live tree only supports assistant delivery.
   - Keep current wire fields stable unless the touched owner can fail closed safely.

5. Core data-shape cleanup.
   - Use canonical automation schema naming.
   - Reject old schedule `timeZone` shape through the shared automation schedule schema.

6. Docs/tests cleanup and verification.
   - Delete the safe historical hard-cut doc owned by this batch.
   - Rewrite coupled seam docs to current ownership.
   - Run full release readiness checks or record exact unrelated blockers.

## Follow-Up Candidates

The broader greenfield hard cut still needs separate, scoped plans for:

- Hosted execution terminology cleanup.
   - Remove `wakeId`/`wakeIds`/`pendingWakeCount` parser fallbacks where they remain.
   - Rename public hosted-execution contracts/builders/parsers to ingress/run/timer concepts.
   - Rename Cloudflare/web callers and expand stale-residue guards.
- Hosted web baseline reset.
   - Remove dead RevNet issuance and generic Linq control-plane surfaces if hosted onboarding is canonical.
   - Delete compatibility barrels and old auth/vault-sync fallbacks.
   - Squash Prisma migrations into one v1 baseline.
- Core data-shape cleanup.
   - Keep `attachments` as the only event attachment surface.
   - Keep `links` as the relation primitive and remove `relatedIds`/`related*Ids` compatibility.
- CLI and package boundary cleanup.
   - Remove duplicate assistant root aliases, `deepthink`, `inbox attachment show-status`, and the `vault-cli` secondary binary if `murph` is canonical.
   - Narrow file-shaped package exports where they are compatibility surfaces.
- Release execution.
   - Run the release script from a clean working tree after unrelated active dirty lanes are landed or isolated with explicit user approval.

## Verification Plan

- `pnpm typecheck`
- `pnpm verify:acceptance`
- `pnpm release:check`
- Focused owner checks for edited packages/apps when full checks are blocked by unrelated dirty rows.
- Required completion workflow audits before handoff.

## Coordination Notes

- Do not touch active dirty Cloudflare deploy/runtime files, hosted assistant provider-config files, or hosted web files unless the phase explicitly owns that overlap.
- Commit only exact touched paths through `scripts/finish-task` while this plan is active.
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
