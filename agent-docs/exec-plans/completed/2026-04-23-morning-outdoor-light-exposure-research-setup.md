# Set up a scoped Health Commons research workspace for a morning outdoor light exposure experiment without widening into source landing or evidence claims

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Set up a Murph Health Commons research workspace for a morning outdoor light exposure experiment without widening into source landing, evidence synthesis, or generated Health Commons outputs.

## Success criteria

- A dedicated workspace exists under `output-packages/research/morning-outdoor-light-exposure`.
- The workspace is scoped as `morning-outdoor-light-exposure` under a broader `morning-light-exposure` family.
- The charter prompt explicitly separates outdoor morning light from indoor bright-light therapy, dawn simulators, daylight through windows, UV/tanning, and exercise-coupled outdoor routines unless later extraction proves a merge.
- The charter prompt biases the research toward circadian, sleep, mood, alertness, and feasible self-experiment outcomes plus safety boundaries such as bipolar or mania risk, photosensitivity, eye disease, and sun/heat exposure context.
- Verification covers the touched setup files and generated workspace state.

## Scope

- In scope:
  - The workspace under `output-packages/research/morning-outdoor-light-exposure`
  - This active plan and the coordination-ledger row needed to reserve the lane
  - Charter-prompt tailoring for family boundaries and experiment-relevant outcomes
- Out of scope:
  - Running the full evidence workflow
  - Landing Health Commons family, protocol, source, or artifact pages
  - Generated catalog updates or broader research-tooling changes

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree work.
  - Keep the workspace repo-local and avoid hardcoded absolute paths.
  - Do not fabricate charter responses, discovery outputs, or source claims during setup.
- Product/process constraints:
  - Treat morning outdoor light exposure as the starter protocol variant unless later research proves a better split.
  - Keep the research boundary aligned with Murph's experiment posture: one bounded intervention, practical testability, and conservative safety framing.

## Risks and mitigations

1. Risk: The family boundary could be too broad and accidentally merge outdoor morning light with indoor light boxes or psychiatric light-therapy protocols.
   Mitigation: Use a family-plus-starter-variant split and make adjacent exclusions explicit in the charter prompt.
2. Risk: Outdoor light exposure can be confounded by walking, exercise, social contact, temperature, or weather.
   Mitigation: Bias the charter toward light-timing questions and call out exercise-coupled outdoor routines as adjacent evidence unless a study isolates the light component well enough.

## Tasks

1. Completed: register the task in the coordination ledger.
2. Completed: scaffold the morning outdoor light exposure workspace with the repo research initializer.
3. Completed: tailor the charter prompt for morning-light family boundaries, experiment-relevant outcomes, and safety questions.
4. Completed: recover the charter response from the exported thread and materialize the workspace.
5. Completed: verify the generated workspace and record the repo-level verification results.

## Decisions

- Use `morning-light-exposure` as the provisional family and `morning-outdoor-light-exposure` as the starter protocol variant.
- Keep indoor bright-light boxes, dawn simulators, window-light approximations, and broader daytime-light hygiene as adjacent or separate variants unless later evidence says otherwise.
- Recover the landed charter from `downloads/01-charter/thread.json` into `responses/01-charter.md` instead of waiting on `thread download`, because the thread returned inline text and no assistant-owned attachment.

## Verification

- Commands to run:
  - `git diff --check`
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
- Expected outcomes:
  - The generated research workspace stays path-relative and ASCII-safe.
  - Repo verification either passes or fails only for a credibly unrelated pre-existing reason called out in handoff.

## Outcome

- Materialized workspace: `output-packages/research/morning-outdoor-light-exposure`
- Recovered charter source: `output-packages/research/morning-outdoor-light-exposure/responses/01-charter.md`
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm verify:acceptance` is currently red for credibly unrelated pre-existing issues in active assistant-runtime and assistant-engine lanes:
  - `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` expects `executeCodexPrompt` to be exported.
  - `packages/assistant-runtime` coverage thresholds fail for `src/hosted-runtime/events/linq.ts` and `src/hosted-runtime/message-cleanup.ts`.
- No scoped commit was created because the actual research workspace lives under ignored `output-packages/**`, and the shared coordination ledger file carries unrelated concurrent churn.
Completed: 2026-04-23
