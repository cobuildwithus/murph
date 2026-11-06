# Persist recurring report corrections

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

- Persist authorized recurring-output corrections before confirming future behavior.

## Success criteria

- Deterministic composed guidance covers durable corrections and row-local formatting.
- Real Codex patches a canonical automation and a fresh scheduled turn uses its saved instructions.
- Focused tests, relevant typecheck, parent review, and required PR checks pass.

## Scope

- In scope: automation authoring guidance, group report presentation, synthetic regression proof.
- Out of scope: production mutations, identity changes, scheduler or storage redesign.

## Constraints

- Reuse canonical automation inspect/patch and current authorized shared rows.
- Keep one-off corrections local; preserve schedule, route, consent, and name ambiguity protections.

## Risks and mitigations

1. First-name formatting could collapse distinct rows. Preserve safe disambiguation and never infer names across rows.
2. A confirmation could claim a failed save. Require successful authoritative readback.

## Tasks

1. Add failing deterministic regression and focused real-Codex journey.
2. Fix the owning guidance and verify canonical save plus fresh report behavior.
3. Add public release note, review, commit, and open a new PR.

## Decisions

- Product UX effort: Patch.
- Outcome: conversational corrections intended for future reports survive a fresh occurrence.
- Reaches: authenticated report authoring and scheduled group presentation; one-off edits retain their scope.
- Proof: canonical versioned patch, unchanged timing/route, fresh same-row report, and collision handling.
- Review routing: prompt-primary change; no new persistence or effect boundary. Parent review owns the candidate.

## Verification

- Focused group presentation and automation tests, Assistant Engine typecheck, and unique Codex-live journeys.
- New composed guidance assertions failed on the base, then passed with the fix.
- Focused Assistant Engine slice: 27 tests passed; changelog production-render slice: 10 passed.
- Assistant Engine typecheck passed. Complexity guard passed with existing unchanged routing hotspots (28 and 25).
- Complete first provider input captured at base and head for private and group fixtures; exact target-model tokenizer unavailable, so token counts are not claimed.
- Real Codex journey passed with GPT-6 Sol and local subscription using an explicitly selected authenticated home: exactly one inspect and one canonical patch, followed by two independent fresh reports. First-name formatting, reordered same-row values, duplicate-name disambiguation, and initial-only preservation all passed. Reviewed all synthetic replies; UX verdict Ready.
- The runner clears inherited home selection unless explicitly configured. Earlier default-home authentication failures did not indicate that the selected authenticated profile was unusable. The live run also caught and corrected a fixture assertion to read the canonical list response items.
- Parent candidate review: current authorized labels remain presentation-only; route, schedule, consent, canonical mutation, and delivery owners are unchanged.
- No repository-actionable Frog entry: explicit local profile selection resolved the authentication setup issue.
- Local proof and parent review are complete; required CI will run on the final pushed candidate and its outcome will be recorded in PR evidence.

- PR: https://github.com/cobuildwithus/murph/pull/3697. No production deployment or mutation performed.
- Reconciled the newer base while preserving both docs-index additions; scheduled fixture advertises only its actual read-only tool port.
Completed: 2026-09-24
