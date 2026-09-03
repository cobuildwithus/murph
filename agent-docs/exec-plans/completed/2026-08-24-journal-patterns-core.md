# Journal And Personal Patterns Core

## Goal

Turn member context and canonical health records into a useful private Journal
and stronger Personal Patterns. Reuse the current vault, query, Browser Vault,
automation, and Murph notification owners.

## Evidence

- Personal Patterns already has one deterministic query owner in
  `@murphai/query`, one Browser Vault projection, one Web presentation, and one
  Weekly health insight consumer.
- The current engine admits only completed activities, interventions, and one
  narrow Oura sauna note rule. It discards timing, amount, duration, subjective
  context, explicit absence, and episode identity.
- Canonical notes and health records already exist in the vault. A Journal can
  be a read model over those records. It does not need a new canonical record
  family or a `journal_day` aggregate.
- The current Personal Patterns UI is useful. Its data and evidence model need
  improvement, not a visual replacement.

## Constraints

- Keep `note` and existing canonical health records as the only product truth.
- Keep independent facts in independent notes. Do not add a Journal table,
  Journal group record, extraction retry system, or second data copy.
- Do not read, write, migrate, or delete `journal_day` in this task.
- Use exact source identity and explicit links for Journal grouping. Do not use
  an AI grouping pass when the page opens.
- Keep Patterns calculation deterministic and bounded. Do not compare every
  field with every outcome.
- Treat missing evidence as unknown. Only an explicit member statement can
  prove that a self-reported factor did not happen.
- Count a multi-day trip, illness, or holiday as one independent episode.
- Reuse the existing Browser Vault, hosted automation, and Murph notification
  paths. Add no scheduler, queue, service, dependency, or database.
- Keep the current Patterns UI. Add only a functional text-first Journal page
  and any minimal data needed by the existing Patterns page.
- Calendar and email travel capture are later features.

## Product UX Plan

Classification: Feature. Journal creates a new private read surface and new
data meaning. Personal Patterns changes from a narrow activity comparison to a
broader personal evidence view.

### Outcome

A member can review one private timeline of relevant health context and see
honest Personal Patterns that use both device data and what the member told
Murph.

### Entry And Promise

The member opens Journal to see canonical records grouped into human events.
The member opens the existing Patterns surface to see the latest saved report.
New canonical evidence becomes visible after the normal Browser Vault refresh.
Patterns recalculates through the existing background owner, never during page
opening.

### Affected People

- A member with device data and notes sees one timeline where related records
  form one event, while each source remains independently correctable.
- A member with notes but no connected device still sees Journal context. The
  Patterns page states when outcomes or comparisons are insufficient.
- A member with rich history sees Patterns, Early signals, and Observations with
  their grade, effect, period, and evidence counts.
- A member with sparse history sees honest low-evidence results. Murph does not
  present one event as a repeated Pattern.
- A member who corrects or removes a note gets a later report derived from the
  corrected canonical records.
- Group-derived notes stay private. Group messages never reveal Journal or
  Pattern data unless the member explicitly asks for that disclosure.

Challenge: a broad engine can create noise or false confidence. The engine uses
a fixed comparison registry, independent episodes, explicit absence, stable
grades, and bounded notifications. The page can show more detail than Murph
sends proactively.

### Proof

- Synthetic canonical records prove Journal grouping without duplicate product
  truth.
- Synthetic histories prove known factor timing, unknown versus absence,
  episode counting, grade changes, and bounded comparisons.
- Browser Vault projection tests prove Journal and Patterns reach Web.
- Web route tests prove populated, sparse, empty, and error-safe text states.
- Automation tests prove page opening does no calculation and background work
  uses the current notification owner without one message per finding.

### Done When

- Journal reads notes, sleep, activity, observations, and tests from canonical
  data and groups only records with direct evidence of one event.
- Personal Patterns uses structured note context and canonical health outcomes,
  preserves unknown evidence, and exposes grades A to E.
- Existing Patterns Web UI reads the new report without a second calculation.
- A text-first Journal route works on phone and desktop.
- Focused tests, typechecks, and direct browser proof pass.
- Calendar and email remain unchanged.

## Plan

1. Map the current note, canonical record, Browser Vault, Patterns, automation,
   and Web owners. Freeze the smallest compatible data contract.
2. Add a Journal query projection over canonical records and include it in the
   Browser Vault core projection.
3. Extend the deterministic Patterns input and result model for atomic note
   facts, explicit absence, timing and amount details, episodes, grades, and
   bounded evidence.
4. Reuse the existing projection and automation paths for background refresh,
   saved reports, Weekly insight context, and bounded Murph wake input.
5. Add a text-first Journal route. Keep the existing Patterns presentation and
   adapt it only to the new report contract.
6. Add synthetic fixtures and focused tests for query, Browser Vault, Web, and
   automation behavior.
7. Run the Product UX walkthrough and focused verification. Stop before
   ReviewGPT, PR creation, and final visual polish as requested.

## Verification

- `pnpm test:diff` completed every affected typecheck, package test, app test,
  production build, smoke check, and generated-artifact check. It found no
  failure caused by this change. The command still reports two workspace
  boundary violations that also reproduce on clean `main`:
  `junction-body-composition-e2e.test.ts` imports the device-sync daemon root,
  and `junction-workout-features-query.test.ts` imports an undeclared importer
  entrypoint.
- The affected suites passed, including 701 query tests, 358 vault-usecase
  tests, 3,993 assistant-engine tests, 10,754 Web tests, 2,601 Cloudflare Node
  tests, and 15 Cloudflare Worker tests.
- The Web production build and development smoke check passed. Local hosted
  HTTP proof returned 200 for the design catalog with the Journal and Patterns
  studies present.
- The embedded browser runtime was unavailable, so visual browser inspection
  remains part of the requested later UI polish pass.
- Focused lint, Web typecheck, docs drift, and `git diff --check` passed after
  final cleanup.

## Product UX Walkthrough

- Device records and directly linked notes appear as one Journal event without
  copying or changing the source records.
- Notes remain useful without a connected device. Patterns states when it lacks
  enough outcome or comparison evidence.
- Subjective outcomes use the same day. Sleep and recovery outcomes use the
  next day.
- One multi-day travel, holiday, or illness episode counts as one evidence case.
- Sparse evidence appears as an Observation or Early signal. One case never
  appears as a repeated Pattern.
- A large first import produces one bounded Murph summary, not one message per
  result. Later grade changes stay in the weekly insight run.
- Corrected or removed canonical records change the next report. The page does
  no calculation when it opens.
- Group-derived notes remain private and follow the separate group-sharing
  rules. Journal and Pattern data never enter a group reply by default.
- Canonical event time zones drive Journal display, including travel days.

## State

Status: completed
deferred to the next session.
Updated: 2026-08-24
Completed: 2026-08-24
Completed: 2026-08-24
