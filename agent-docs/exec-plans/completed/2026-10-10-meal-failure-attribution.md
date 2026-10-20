# Meal failure attribution

Status: completed (authoring handoff; investigator validation and delivery remain separate)

## Outcome and invariant

Retain three exact public meal-edit validation field names and the existing
ordinary-photo removal rejection code in existing optional CLI diagnostics.
Preserve all public outputs, prompts, tool schemas, exits, handlers, canonical
effects, provider calls and retry behavior. No production observations belong
in this plan or its fixtures.

## Owner and decision

Extend `packages/runtime-state/src/cli-timing.ts`, its existing Node observer
and the assistant completion reader. The registered meal schema already owns
id, nutritionProteinGrams and nutritionConfidence; no schema changes are needed.
The event mutation owner already maps the automatic-photo source rejection to
invalid_operation. Admission of that code requires the resolved meal remove-photo
command at each existing reader/producer seam. This reuses the code field instead
of adding an optional dimension, hook, parser, event, state or dependency.
Deletion/reordering cannot retain values missing from the diagnostic vocabulary.
All canonical authority and execution behavior stay with existing owners.

## Proof and handoff

The patch extends existing synthetic registered-CLI tests for direct/batch
validation, handler/write/provider counts, public output parity, valid typed
meal save/edit/read and wiki upsert/read, ordinary-photo rejection, and automatic
removal/idempotency. Runtime tests cover finite own-data selection, hostile
properties, scoped codes, saturation, merging and legacy absence. Engine tests
cover sender/receiver fitting, profile/hosted admission and completion diagnostics.
History-backed portable/hosted tests take the exact pre-extension commit through
MURPH_CLI_MEAL_FAILURE_ATTRIBUTION_COMPAT_BASE; they must not silently substitute
a current reader for the old one. Detailed synthetic evidence and validation
commands stay outside repository artifacts with the investigator.

Authoring is handed off, not a claim that installed-workspace tests, exact-head
CI, independent review or deployment have passed. The snapshot lacks installed
workspace dependencies and Git history; those gates remain investigator-owned.
No external member/provider system, Git commit, PR, merge or deployment is part
of this authoring task.

## Rollout and decision boundary

The durable contract, bounded post-convergence query, saturation interpretation
and single naturally attributed failure threshold live in
`docs/hosted-runtime-log-database.md`. Readers (including warm consumers) precede
writers. Old readers lose specificity, not timing/accounting; old unknowns cannot
be backfilled. Investigate a newly attributed singleton only after verified
reader/writer convergence, then prove a behavioral cause before proposing a fix.
Paid-model replay is not waived merely because the patch is telemetry-only:
the investigator must first establish exact member-visible and prompt/tool parity.
