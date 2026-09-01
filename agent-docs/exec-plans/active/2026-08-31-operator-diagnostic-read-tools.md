# Operator Diagnostic Read Tools

Status: ready for commit; exact-head gates pending
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Let an authorized operator diagnostic inspect the targeted Murph workspace with existing read-only tool authority so it can answer concrete questions such as an automation's stored support kind.

## Success criteria

- The operator diagnostic no longer instructs Murph not to invoke tools.
- Filesystem access remains bounded to the targeted workspace by the existing named permission profile; network access, mutation, and member-facing delivery remain unavailable.
- Deterministic tests prove the composed operator disclosure and independent capability boundary.
- A focused synthetic real-Codex journey reads a canonical automation record and returns the requested field without changing canonical state or sending anything.
- Required focused tests, typecheck, complexity check, exact-head CI, and final trust-boundary review pass.

## Scope

- In scope:
  - Operator-task diagnostic disclosure and its existing consented read-only Assistant Ask path.
  - Focused deterministic and live-model regression proof.
  - Any minimal shared prompt owner needed to keep production and proof aligned.
- Out of scope:
  - Member or group Assistant Ask permissions.
  - Network access, mutation tools, outbound member messages, or cross-workspace inspection.
  - A new operator automation-inspection service or persisted diagnostic state.
  - The separate group-update single-value presentation change.

## Constraints

- Technical constraints:
  - Reuse the existing `murph-group-read` filesystem and network permission profile.
  - Keep the disclosure reviewer tool-free and preserve its permission decision.
  - Do not widen `.runtime`, `.codex`, vault-share, environment-file, or network access.
- Product/process constraints:
  - Product UX Patch:
    - Outcome: an authorized operator can inspect canonical facts in the targeted read-only workspace instead of receiving a generic cannot-answer result.
    - Reaches: the operator receives the diagnostic; the target member or group receives no member-facing message or canonical workspace mutation; people outside the target workspace gain no disclosure path.
    - Proof: a synthetic real-Codex diagnostic reports canonical automation metadata while every canonical vault file remains byte-for-byte unchanged.
  - This trust-boundary change uses the PR lane and final ReviewGPT gate.

## Risks and mitigations

1. Risk: Workspace content could attempt prompt injection once the model reads files.
   Mitigation: Preserve the production instruction that treats workspace files as untrusted data, the read-only named permission profile, and the separate disclosure review.
2. Risk: Removing one prompt guard could accidentally expose write or network tools.
   Mitigation: Prove the provider request still uses `approvalPolicy: never`, the workspace-root-scoped named permission profile, and a network-disabled capability environment without a legacy sandbox field.
3. Risk: A diagnostic could answer beyond the operator-authorized target.
   Mitigation: Preserve exact target-runtime binding, targeted workspace roots, permission context, and the final disclosure reviewer.
4. Risk: Making the target workspace the child process working directory could load target-local Codex configuration before the read-only profile applies.
   Mitigation: Keep every child in an isolated working directory, pass the exact authorized target path as quoted host prompt data, and prove a trusted synthetic target-local MCP config cannot start.

## Tasks

1. [x] Trace the operator diagnostic from admission through tool execution and result review.
2. [x] Delete the contradictory tool prohibition at its owning disclosure boundary.
3. [x] Add deterministic composition and capability tests.
4. [x] Add and run one focused real-Codex automation-inspection journey.
5. [x] Complete focused local verification, Product UX walkthrough, and final trust-boundary review.
6. [ ] Run exact-head GitHub checks and final ReviewGPT after the scoped commit is pushed.

## Decisions

- Keep tool authority enforced by the existing Codex `murph-group-read` permission profile instead of adding a feature-specific tool proxy or treating provider metadata as a second boundary.
- Keep the review stage tool-free; only the answer stage needs read access.
- Treat the earlier single-value reminder rule as a separate product change so this trust-boundary patch remains reviewable.
- Do not create a Frog entry: the Frog skill excludes observed production runtime/support failures from its public issue path.

## Verification

- Passed:
  - Focused Assistant Ask engine tests (16 tests), detached runtime tests (23 tests),
    signed Web route tests (7 tests), and hosted-execution operator-task tests
    (4 tests).
  - The focused real-Codex engine journey read the exact synthetic automation
    identifier, review support kind, schedule time, and timezone in two provider
    stages. A trusted target-local MCP launch trap remained untouched and every
    canonical workspace file remained byte-for-byte unchanged.
  - Typechecks in `packages/assistant-engine`, `packages/assistant-runtime`,
    `packages/hosted-execution`, and `apps/web`.
  - `pnpm complexity:diff` and `git diff --check`.
  - Final trust-boundary review: no concrete authority, privacy,
    reviewer-isolation, prompt, documentation, or proof finding.
- Required after push:
  - Exact-head GitHub checks and final ReviewGPT.

## Product UX Walkthrough

- Operator targeting a personal runtime: the form identifies the diagnostic as
  a private read-only workspace question, and Murph can inspect the authorized
  workspace instead of refusing solely because conversation evidence is empty.
- Operator targeting a group runtime: the same private diagnostic can read that
  bound group workspace; completion returns only to Ops and creates no group
  mailbox or delivery handoff.
- Target member or group: receives no message and has no canonical file changed.
- Any other workspace: is absent from both the runtime roots and the prompt, so
  the candidate has no cross-workspace path.
- Insufficient authorized evidence or a denied disclosure: retains the existing
  cannot-answer result and ordinary retry/recovery behavior.
- Design proof: this is copy-only clarification on the existing production Ops
  Tasks route; it changes no component, layout, interaction, responsive state,
  or accessibility behavior, so no new design catalog study is needed.
- Result: Ready for the exact-head PR gates.
