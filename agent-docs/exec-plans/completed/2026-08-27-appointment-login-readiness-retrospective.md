# Appointment Login Readiness Retrospective

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Resolve the ReviewGPT round-two retrospective by removing the circular
  ordering between appointment readiness and logged-out portal authentication.
  A private member delegating appointment check-in can hand off login first,
  then Murph resumes, discovers hidden destination requirements, and completes
  only the authorized disclosure or mutation steps.

## Success criteria

- The appointment and computer-use skills name one owner for login
  establishment and one owner for appointment disclosure readiness.
- Deterministic tests prove the composed guidance has no logged-out portal
  deadlock or competing pre-readiness login prohibition.
- The focused real-Codex journey starts logged out, pauses at the exact login
  handoff, resumes, discovers hidden required fields, and completes without
  premature disclosure, duplicate authorization, or unsupported memory writes.
- Focused Assistant Engine tests, typecheck, privacy/scope scans, PR evidence,
  and the next ReviewGPT round are ready for the exact pushed head.

## Scope

- In scope: appointment-scheduling skill text, computer-use skill text,
  top-level execution authority, assistant prompt/skill regression coverage,
  the existing appointment real-Codex journey, PR evidence, and this
  retrospective record.
- Out of scope: new browser runtime behavior, new storage, new memory owner,
  password or full payment-card entry, CAPTCHA bypass, or a new policy manager.

## Constraints

- Technical constraints: reuse the existing browser pause/resume tools and
  appointment ready-to-act gate; add no durable state, schema, queue, or retry
  mechanism.
- Product/process constraints: keep the existing PR promise that supported
  exact-point private handoff is in scope, preserve user control over passwords,
  full card entry, and materially new legal or privacy choices, and carry this
  retrospective decision in later ReviewGPT metadata.

## Risks and mitigations

1. Risk: a login handoff is mistaken for permission to submit health or identity
   data.
   Mitigation: state that handoff establishes browser access only; destination
   disclosure and mutation still require the appointment ready-to-act gate.
2. Risk: remediation adds another special-case exception.
   Mitigation: delete the appointment-specific login prohibition and delegate
   all authentication establishment to `computer-use`.

## Tasks

1. Completed: record the retrospective decision.
2. Completed: align `appointment-scheduling` and `computer-use` around the single ordering
   rule.
3. Completed: extend deterministic prompt/skill proof for the composed boundary.
4. Completed: extend the focused live appointment check-in journey to cover logged-out
   login handoff and resumed requirement discovery.
5. Completed locally: run focused verification, inspect the diff, and update PR
   evidence. Exact-head push, ReviewGPT, CI, and merge follow this plan archive.

## Decisions

- Supported appointment check-in/intake includes official portals whose actual
  requirements are hidden until the user completes a credential handoff.
- `computer-use` owns authentication establishment: navigate to the specific
  login form, pause with the right handoff purpose, and resume the same run.
- `appointment-scheduling` owns disclosure/mutation readiness after requirements
  are known. Login handoff is not itself readiness, user-data disclosure, or a
  mutating appointment step.
- End-to-end authority covers ordinary in-scope navigation, relevant reliable
  saved facts, expected acknowledgements, and bounded recovery. A different
  destination or purpose is scope drift rather than takeover of the whole task.
- Password and full payment-card entry remain member steps. Human-only
  authentication challenges receive the smallest exact-point handoff, after
  which Murph resumes the same run and finishes under the original authority.
- The smallest durable fix is ordering and ownership deletion, not another
  readiness exception or parallel authentication policy.

## Verification

- Commands to run:
  - focused Assistant Engine Vitest files covering appointment skill, computer
    tool contracts, and composed prompt guidance
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm test:assistant:live -- --test "<logged-out appointment pattern>"`
  - `git diff --check`
- Results:
  - Six focused Assistant Engine files: 150 passed, 7 opt-in cases skipped.
  - Assistant Engine typecheck: passed.
  - GPT-5.6 TERRA logged-out journey: passed with one login handoff, resumed
    hidden-requirement inspection, four browser actions, three state opens, one
    OS fallback, one finish, no second handoff, and verified completion.
  - The journey read canonical memory before disclosure and made no unsupported
    insurance-memory write.
  - `git diff --check`: passed.
Completed: 2026-08-27
