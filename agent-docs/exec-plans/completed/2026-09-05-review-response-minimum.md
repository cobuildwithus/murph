# Enforce the marked ReviewGPT response minimum

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Enforce the existing 270-second minimum even when a marked concrete-model review
has compatible model metadata. Issue #2903 is the existing friction authority.

## Scope and constraints

Patch the installed duration owner through the existing registry dependency
patch. Preserve unmarked/current-selection behavior, exact model and committed
turn checks, diagnostic-only rejection, and capture digest validation. Do not
change the repository minimum, introduce another timer, or touch production.

## Evidence and tasks

- Actual installed exports reproduce two failures: compatible metadata bypasses
  both the floor and the diagnostic-only rejection path; three other checks pass.
- Remove only that shortcut and obsolete diagnostic wording; prove boundary,
  nonfinite input, model, turn, and digest behavior through actual exports.
- Generate the patch/lock through native pnpm and inspect graph changes without
  blindly restoring generated peer snapshots. Preserve supply-chain controls.
- Run focused checks, full canonical review, and exact-head CI; prepare a human
  merge handoff. Do not merge, close the issue, or retire the open-PR checkout.

## Coordination

PR #2929 owns separate ZIP listing changes in the same dependency. Its candidate
stays untouched. Source owners differ, but patch hashes share lockfile positions.
Document merge order: #2929 first, then reconcile this PR against its landed main
and rerun exact-head CI. Do not duplicate its code or create a stacked PR.

## Verification

Native patch generation and frozen install pass. Five installed-export tests
pass after two expected baseline failures. Focused TypeScript 7, documentation,
complexity and dependency policy checks pass. Audit reports 93 existing
advisories on unchanged package versions; blocked scripts remain blocked.

The complete generated lock equals PR #2929 after only the intended patch hash
substitution, with an identical baseline lock and its proved peer-key renaming.
Its exact listing delta applies cleanly alongside this unchanged duration owner.
Full review and exact-head CI remain final handoff gates. The supported review
packet supplements the full repository ZIP with bounded verbatim installed
owner spans. New prompt-prefill friction is recorded with this task.
Completed: 2026-09-05
