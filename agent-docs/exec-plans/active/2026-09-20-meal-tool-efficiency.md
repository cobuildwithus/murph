# Reduce avoidable meal tool work

Status: active
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and scope

Restore the existing meal workflow: use documented date filters and typed save
arguments, and inspect an available official nutrition page before falling back
to an estimate. Preserve numeric preferences, provenance, canonical save
readback, and browser authority. No new CLI, state, lookup service, or scheduler.

## Evidence and owner

The meal CLI owns date ranges through `--from` and `--to`. The food-journal
skill documents these only in later recovery guidance, while its capture path
lacks an explicit day-read recipe. The existing official-source journey returns
full nutrition on browser open and never exercises landing-page navigation.
The food-journal skill is the smallest owner for the workflow clarification;
existing CLI and computer tools already support the required operations.

## Product UX

- Outcome: complete meal capture with less avoidable discovery and grounded nutrition.
- Reaches: new meal saves, explicitly requested day reads, exact-label misses,
  official landing pages, and honest fallback when item nutrition is unavailable.
- Proof: deterministic composed skill checks and focused real-Codex journeys
  using synthetic meals, CLI evidence, and browser responses. Numeric suppression
  and successful save-and-totals behavior remain covered.

## Implementation and proof

1. Add deterministic regression checks, then clarify the existing skill.
2. Extend the live day-read/save journey to reject wrong flags and unnecessary
   schema discovery. Strengthen official-source proof beyond the landing page.
3. Run focused tests and typechecks, review synthetic replies, and add a public
   outcome changelog entry. Skill bodies load after the first provider request;
   initial prompt, tool schemas, and router metadata remain unchanged.
4. Review the diff and complexity, close this plan, commit, open a draft PR,
   then mark Ready after focused proof and monitor exact-head required CI.

## Review and deployment

Prompt-primary scope uses parent candidate review and focused real-model proof.
Re-evaluate ReviewGPT eligibility if backend or independent sensitive behavior
changes. Skills ship in the ordinary runtime artifact; old and new runtimes
remain compatible, with no migration or consumer-first protocol requirement.

## Verification results

- Composed food-journal regression: 5 passed, including a red run before the skill change.
- Assistant Engine and hosted Web typechecks: passed.
- Changelog archive rendering: 10 passed using the repository-root Vitest config.
  The app-directory command discovers no files; this is already recorded in Frog.
- Complexity guard: passed; only test TypeScript changed, no authored runtime
  JavaScript/TypeScript functions entered the metric.
- Live proof: pending. The default local subscription and two alternate profiles
  failed before any provider action; the next permitted profile is running.
- Candidate review: production scope is limited to the existing food skill;
  numeric suitability, browser authority, tool schemas, and persistence are unchanged.
