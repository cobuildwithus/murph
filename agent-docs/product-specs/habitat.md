# Habitat: Progressive Member Life-Context

Last verified: 2026-10-19

## Product boundary

Habitat is private canonical knowledge about a member's living circumstances,
workspace, equipment and preferences. Murph reads and collects this context
through ordinary conversations and the vault CLI. The Environment dashboard,
reports, voice walkthrough and dedicated weather display are retired.

Habitat is not assistant runtime state or Health Commons content. Medical
conditions, allergies and regimens keep their existing record families.
Wearable integrations keep their existing owners; Habitat health-device facts
cover standalone equipment. Diet remains outside this family.

## Canonical owners

- `packages/contracts/src/habitat-catalog.ts` owns the versioned domain, aspect,
  indicator, priority, allowed-value and evidence-target catalog.
- `packages/core/src/bank/habitat.ts` owns canonical mutations through the
  ordinary bank registry, one Markdown record per aspect under `bank/habitat/`.
- `packages/query/src/health/habitat.ts` owns canonical reads. New Browser Vault
  replicas omit Habitat records after removal of their only browser consumer;
  ordinary Journal events retain their own projection.
- `packages/cli/src/commands/habitat.ts` exposes `save`, `show`, `list`,
  `coverage` and `catalog`. The assistant uses this same public CLI boundary.
- `packages/contracts/src/habitat-coverage.ts` derives known, unknown,
  declined and stale coverage without storing scores or introducing state.

The catalog, rather than a second documentation table, is authoritative for
current indicators. Domains remain `environment`, `workspace` and `exercise`.
The environment domain denotes living context, not a dashboard capability.

## Record rules

Atomic indicators carry catalog-valid values, unknown/null or `declined`.
Concise indicator notes retain useful measurements, brands, models, setup,
limits and exceptions that the atomic value cannot express. Corrections replace
the affected summary; raw transcripts never become Habitat records. The record
body remains available for broader authored context.

A declined answer is respected until the member reopens it. High-priority stale
facts may be reconfirmed when relevant to the current conversation. Location is
member-stated city or approximate region, never a precise home address.
Existing records are retained when the Environment feature is removed.

## Collection and use

Read known context before offering advice about home conditions or equipment.
Ask only about a missing fact that would improve the current help; never start
an unprompted survey or repeat declined questions. Photos and ordinary messages
may supply context through existing conversational ingestion. Save accepted
facts through the canonical Habitat command with dates and concise notes.

Natural descriptions may map to catalog values when the meaning is clear.
Ambiguous details remain unknown. Do not maintain a separate synonym catalog
without a demonstrated need. Coverage is advisory evidence, not a question
queue, grade, equipment score or universal onboarding checkpoint.

## Feature retirement

No Environment routes, capture sessions, report grading, share images or
special-purpose mailbox handlers remain. Historical event metadata uses the
existing retired-mailbox registry and cannot admit new work. Shared assistant weather tools and
ordinary audio ingestion retain their own owners.

Unimported retired events skip before payload retrieval; saved system-mailbox
state discards retired wakes, including obsolete completion/recording records,
before active parsing. No old-runtime drain is required. Preserve the existing
R2 expiration and account-deletion prefix sweep for residual encrypted
recordings, including recordings whose completion was discarded. Canonical
Habitat records need no destructive migration.
