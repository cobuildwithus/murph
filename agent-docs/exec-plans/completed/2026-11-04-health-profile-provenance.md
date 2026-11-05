# Health profile CLI and evidence provenance in the Murph prompt

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal

When a member gives Murph their blood type, by text, voice or a screenshot of a
lab result, Murph saves it in one obvious place and can read it back later from
any new conversation. Murph never says a fact is "in your records" unless a
vault read returned it.

## Incident (de-identified)

A member asked for their blood type. The vault had none, and Murph correctly
said so. The member then sent a lab-result image and asked about later access.
Murph described the value it had just read from the image as an existing
record, promised later recall, and saved nothing, so a fresh conversation
would fail the same way.

The prompt already required that save (Health record ingestion invariant;
User-provided content and vault writes). Two causes remain:

1. **Prompt.** The private-turn developer instructions are about 105KB (~26k
   tokens, 268 bullets) before a ~14KB CLI contract and 49 tool descriptions.
   Many incident-specific rules about claims and writes exist ("claim actions
   only when runtime results prove them", "if the result says nothing changed,
   do not claim that something new was saved"). None states the general rule:
   name where a fact came from, and only a vault read establishes that
   something is saved. OpenAI's GPT-6 guidance says the model follows
   instructions more literally and recommends auditing for conflicting or
   unclear guidance. A full prompt audit runs separately (see Follow-ups).
2. **Tooling.** Blood type has no canonical identity. A model can store it as a
   blood-test result under any analyte name ("ABO Group", "Blood type"), or in
   memory. The snapshot tells Murph to look up a biomarker with
   `vault-cli blood-test list --text "<biomarker>"`, which is a substring match,
   so "blood type" never matches "ABO group". The context snapshot does not say
   whether a blood type is saved.

## Design

No new record family. A blood type is a lab result, so it stays a blood-test
event with one result. This PR adds a canonical identity, one read/write CLI
surface and a short prompt contract. (Revised after the ReviewGPT plan review;
see Decisions.)

1. **Canonical identity (contracts).** `BLOOD_TYPE_RESULT_SLUG = "blood-type"`
   plus a pure normalizer that accepts `AB+`, `AB positive`, `ab pos`,
   `O neg`, `O−` and similar, and returns `{ abo, rh, value: "AB+" }`.
   Anything else is rejected; "unknown" is not a value.
2. **Current blood type (query).** One pure selector over live blood-test
   records, used by both CLI commands. Candidates: results with slug
   `blood-type`, or an alias analyte/slug (`abo`, `abo group`, `abo/rh`,
   `blood group`, `blood type`) whose text normalizes. Order: `recordedAt`
   (save time) descending, then `occurredAt` descending, then event id
   descending. A correction saved later wins even with an older lab date.
   Legacy events whose `recordedAt` equals `occurredAt` keep this deterministic
   fallback; old evidence is not rewritten.
3. **CLI: `vault-cli profile`** (new command group, `packages/cli/src/commands/profile.ts`).
   - `profile show` returns `{ bloodType: { value, abo, rh, eventId,
     occurredAt, recordedAt, source } | null }`. A null value means no
     recognizable blood type exists in blood-test history; it does not claim
     that no retained document mentions one.
   - `profile set --blood-type <value> [--occurred-at] [--source] [--note]
     [--raw-ref raw/...]` normalizes the value and appends one blood-test event
     through `appendBloodTest`, with result `{ analyte: "Blood type (ABO/Rh)",
     slug: "blood-type", textValue: "AB+" }` and `recordedAt` set to the save
     time. It returns `unchanged` only for an exact retry: the current value
     matches and every supplied option is already on the current event.
     Anything new (a different value, a new raw ref, date, source or note)
     appends another observation, so supplied evidence is never discarded.
     The read, compare and append run inside one `withCanonicalWriteLock`.
   - "Profile" is the home for stable personal health facts that have no other
     family. Blood type is the only field in this PR.
4. **Prompt (targeted).** One provenance and persistence principle in
   `buildAssistantTurnPriorityText`, and one routing line for blood type in
   `buildAssistantVaultNavigationText` (always present in private turns; not
   the hosted-labs guidance, which is gated on hosted lab availability). The
   context snapshot is not changed.

## Success criteria

- `profile set --blood-type "AB positive"` writes one blood-test event;
  `profile show` returns `AB+` with that event id; an exact retry returns
  `unchanged`; the same value with a new raw ref appends.
- O+ saved today, then AB+ saved with an older lab date: `profile show`
  returns AB+.
- A legacy result with analyte "ABO Group" and textValue "AB Positive" inside a
  larger panel is returned by `profile show`, and the panel is untouched.
- Two concurrent identical `profile set` calls commit one event.
- The composed private prompt contains the provenance principle and the
  profile routing line once each.
- Live real-Codex journey (synthetic): no saved blood type, member asks, then
  asks for a place to save it, then sends a lab screenshot. Expected: one
  blood-type write, a reply that does not call the new value an existing record,
  and a fresh session that reads the saved value back without writing.
  Verdict recorded as Ready/Hold.

## Scope

- In scope: contracts normalizer and slug; query selector; `profile show|set`;
  the two prompt additions; deterministic tests; one live journey; CLI contract
  regeneration.
- Out of scope: the broader prompt diet; mapping MyChart LOINC 882-1/883-9/10331-7
  results to `blood-type` in the clinical importer; any web or iOS UI; writing
  the owner's own blood type (the owner can text Murph after deploy).

## Risks and mitigations

1. Risk: a second home for lab facts drifts from blood-test history.
   Mitigation: no second store; `profile` reads and writes blood-test events.
2. Risk: deploy skew between web and runner versions of the CLI contract.
   Mitigation: additive command; the prompt line ships in the same runner
   bundle as the command, and the generated CLI surface is regenerated.

## Tasks

1. Contracts: slug constant and normalizer with tests.
2. Query: current blood-type selector with tests.
3. CLI `profile show|set` with tests; regenerate the CLI surface artifacts.
4. Prompt principle and routing line with deterministic prompt tests.
5. Live journey in `assistant-codex-real-e2e.test.ts`; run it.
6. Docs owner updates (CLI/vault docs that list command families).
7. PR, CI and the ReviewGPT PR loop.

## Decisions

- Blood type stays a blood-test result (no new record family).
- A new `profile` command group owns read/write for stable personal facts with
  no other home.
- ReviewGPT plan review (2026-11-04), all four findings accepted:
  1. P1 "latest saved" ordering: accepted. Selection is by save time
     (`recordedAt`, written explicitly by `profile set`), then lab date, then
     id. Evidence: `buildHistoryEventRecord` defaults `recordedAt` to
     `occurredAt`, and `listBloodTests` sorts by `occurredAt`.
  2. P2 delete the snapshot line: accepted. The snapshot header already says it
     is stale navigation and requires a vault read before factual claims, so a
     cached value cannot replace `profile show`. Routing lives in vault
     navigation, not the hosted-labs section.
  3. P2 unchanged discarding evidence: accepted. `unchanged` only for an exact
     retry; new evidence appends.
  4. P2 atomic read-compare-append: accepted. One `withCanonicalWriteLock`
     around the selector and `appendBloodTest` (the lock is reentrant through
     AsyncLocalStorage).
  5. Live proof: accepted. Fresh-session recall phase added.
- Baseline before any change (gpt-6.1-terra, current prompt, synthetic vault,
  CLI contract null in the harness): the screenshot was saved 8/8 times
  (5 with image and question together, 3 with the question steered in). The
  production misattribution did not reproduce in the harness. Every run spent
  3 to 6 `--help` calls finding a command and used a different analyte name
  ("Blood type", "ABO and Rh blood type", "ABO group and Rh"), so a later
  `blood-test list --text` lookup depends on wording.

## Follow-ups

- Prompt diet: a separate PR that moves turn-irrelevant sections (hosted group
  guidance in private turns, reminder time selection, and similar) into on-demand
  skills and removes duplicated incident rules, measured by the existing live
  journeys. Findings from the read-only prompt audit feed that PR.
- Clinical importer: map ABO/Rh LOINC results to the `blood-type` slug.

## Verification

- Deterministic: `packages/contracts/test/blood-type.test.ts` (28),
  `packages/cli/test/profile-command.test.ts` (7: save/readback, exact retry vs
  new evidence, older-dated correction wins, legacy "ABO Group" in a panel with
  the panel untouched, separate ABO and Rh rows, concurrent identical sets
  commit one event, invalid value), CLI wiring/routing/schema/smoke suites,
  `model-behavior.test.ts` (always-on budget holds; route hash updated),
  typecheck for contracts, query, cli and assistant-engine, and
  `verify-runtime-artifacts`.
- Live (gpt-6.1-terra, scoped production CLI contract, synthetic vault): both
  delivery shapes pass, including the fresh-session recall phase, on two
  separate prompt wordings. Each journey ran 3 or 4 commands (`profile show`,
  sometimes one Commons search, `profile set`, then `profile show` in the fresh
  session), against 8 to 11 commands with 3 to 6 `--help` probes in the
  baseline. Verdict: Ready.
- Initial input: private prompt +527 bytes, +122 o200k tokens (+0.58%); group
  prompt unchanged; CLI family index gains one `profile` line.
- Complexity: the scoped CLI router's 17 CLI-only roots moved into one
  registrar table (debt 23 to 8) instead of adding a case.
- Final ReviewGPT (PR #4573, round 1 at 8c5195e1d9): PASS, no findings.
Completed: 2026-11-04
