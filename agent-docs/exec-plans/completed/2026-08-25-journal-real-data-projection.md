# Journal real-data projection and weekly UI

## Outcome

Journal turns dense wearable records into a calm weekly health timeline without
changing canonical data or the evidence used by Personal Patterns.

## Product UX

- **Level:** Product change.
- **Reaches:** `/journal`, its Browser Vault projection, and the Journal design study.
- **Promise:** A member can scan one week and understand sleep, activity, notes,
  tests, plans, experiments, environment changes, and relevant context.
- **Affected people:** A member with rich Oura data, a member with sparse or no
  device data, and the same people on desktop and a narrow phone.
- **Weak states:** No data, missing sleep metrics, naps without a main sleep,
  repeated activity sessions, and incomplete current weeks remain useful and
  honest.

## Decisions

1. Keep canonical source records unchanged. `@murphai/query` derives the Journal view.
2. Show one selected main sleep per local date without a clock time.
3. Show naps as separate timed events.
4. Group same-kind activity sessions on one day for display only. Keep every
   source session inside the event for evidence and Patterns.
5. Hide static profile records and duplicate recovery metrics from Journal.
6. Keep source labels as secondary detail, not permanent visual noise.
7. Calculate weekly sleep statistics from main sleep only.
8. Keep the page readable without opening event details. Links may take a member
   to an existing related product page when that destination adds value.

## Work

- [x] Add focused projection tests for main sleep, naps, repeated activities,
  hidden profile data, duplicate metrics, formatting, and weekly summaries.
- [x] Update the Journal query projection with the smallest deterministic rules.
- [x] Replace the raw record list with the approved weekly timeline UI.
- [x] Update the `/design` Journal study with representative synthetic data.
- [x] Update the Journal product spec and Paper design to the same behavior.
- [x] Run focused query, web, type, detector, and desktop/mobile browser proof.

## Done when

- A rich Oura week reads as a small set of human events.
- Main sleep never appears at an import or wake-up artifact time.
- Naps and repeated activities remain visible without inflating weekly sleep.
- Empty and sparse weeks stay clear.
- Paper, the design study, and production code show the same product.
Status: completed
Updated: 2026-08-25
Completed: 2026-08-25
