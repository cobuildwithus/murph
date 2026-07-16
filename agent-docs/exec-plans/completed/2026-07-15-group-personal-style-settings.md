# Group-chat personal style settings

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let a member read and update their own Tone, Voice, Humor, Push, and Detail
  settings from an authenticated hosted group-chat turn.

## Success criteria

- A group-chat request resolves the current speaker through server-owned route
  and sender evidence to an active Murph member; the model cannot provide or
  select a member identity.
- Tone, Voice, Humor, Push, and Detail reuse the existing hosted member
  preference owner and mailbox convergence path.
- The change never applies a member's personal settings to the room prompt,
  never mutates group-wide style, and fails closed for email or ambiguous,
  unknown, suspended, or inactive Murph senders.
- Private direct-conversation behavior and the existing Settings UI remain
  unchanged.
- Focused owner tests, full required verification, required audits, PR CI, and
  the ReviewGPT gate pass with no unresolved accepted finding.

## Scope

- In scope: hosted group-turn sender authority, assistant style and
  personalization tool availability/execution, web-owned member preference
  callbacks, shared contracts/parsers, focused tests, and matching durable
  architecture/security/product docs.
- Out of scope: web UI changes, group-wide personality storage or behavior,
  model/reasoning changes, unauthenticated group email, and arbitrary member
  selection.

## Constraints

- Keep the group runtime a synthetic room container; do not grant it general
  personal-member authority.
- Reuse existing current-sender proof and canonical preference mutation owners.
- Add no new persisted state, identity selector, compatibility shim, or second
  preference store without concrete evidence that the existing owners cannot
  support the behavior.
- Work only in `/private/tmp/murph-group-personal-style` on
  `codex/group-personal-style`; preserve unrelated active lanes.

## Risks and mitigations

1. Risk: a group runtime could mutate the room container or the wrong member.
   Mitigation: derive one current sender server-side from the accepted group
   input and route, bind it to one active hosted member, and reject caller-
   supplied identity.
2. Risk: group-lane ordering could conflict with the member's personal
   preference lane.
   Mitigation: have the web-owned member mutation transaction append the
   personal mailbox event with that member lane's own serialized sequence.
3. Risk: private preferences could leak into group prompt behavior.
   Mitigation: expose only the explicit settings operation; keep prompt
   assembly and room behavior independent of any member's saved dials.
4. Risk: Web, Worker, and warm runner versions can disagree during rollout.
   Mitigation: keep old callers working, reject unsupported group-personal
   actions safely, document deployment order, and require immediate runner
   convergence if the shared runtime contract cannot be skew-safe.

## Tasks

1. Trace the current private personalization path and group current-sender
   authority end to end; prove the smallest safe reuse point.
2. Update contracts and runtime planning/execution to carry group current-
   sender authority without model-selectable identity.
3. Extend the web-owned preference mutation path for the resolved group member
   and add focused authorization, ordering, failure, and regression tests.
4. Update durable architecture, security, product, command, and verification
   documentation where the audience boundary changes.
5. Run required verification and audits, parent final review, close the plan,
   commit, push, open the PR, and complete CI plus ReviewGPT.

## Decisions

- Personal settings remain member-scoped even when the command originates in a
  room. This is not a group-wide style feature.
- Group-email replies remain ineligible because their sender identity is not
  authenticated.
- A current authenticated Linq speaker does not need a persisted hosted-group
  membership to manage their own personal style. The accepted chat sender plus
  one active hosted-member match is the authority; the synthetic room remains
  active and gains no member-private access of its own.
- Group-origin writes do not reuse the room container's causal sequence. The
  existing member preference transaction appends a fresh member-mailbox event
  and uses that serialized member sequence as the field watermark.

## Verification

- Typechecks passed for `@murphai/hosted-execution`,
  `@murphai/assistant-runtime`, `@murphai/assistant-engine`, and hosted web.
- Focused proof passed: hosted runtime-control parsers (52 tests), Linq sender
  binding (13 tests), hosted web group-tool ownership (68 tests), and the
  assistant group-tool/prompt stack (172 tests across five files).
- The required `coverage-write` audit added only trust-boundary proof for
  malformed settings, direct/missing sender contexts, the personality rollout
  gate, tone/voice behavior under that gate, and suspended/unresolved members.
  Hosted-execution full coverage passed (344 tests; 87.63% statements), and the
  focused web group-tool coverage passed (91.5% statements).
- `pnpm verify:acceptance` completed all repository guards, typechecks, web
  lint/build/tests, and owner suites, but its heavily parallel coverage phase
  reported one unrelated CLI timeout and one assistant-engine worker memory
  exit. Sequential reruns passed: CLI coverage (1,089 passed, 1 skipped) and
  assistant-engine coverage (2,269 passed, 5 skipped; 89.98% statements).
- Parent final review confirmed the model has no identity selector, accepted
  non-direct Linq evidence is the only sender authority, email/direct/missing/
  ambiguous/unknown/suspended/inactive contexts fail closed, the existing
  member preference owner remains canonical, and no room prompt consumes the
  member's saved style.
- `git diff --check` and the added-line privacy/credential scan passed. PR CI,
  ReviewGPT, and merge proof remain as post-push gates.
Completed: 2026-07-15
