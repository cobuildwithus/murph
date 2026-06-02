# Agent debugging rules

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Strengthen bug-investigation proof rules while reducing privacy-driven friction that slows local debugging.

## Success criteria

- `AGENTS.md` explicitly forbids hunch-first bug investigations and assumption-driven fixes.
- The rule allows hypotheses only as evidence-gathering prompts.
- The rule requires static/code-path/runtime/test proof of the root cause before a fix.
- Agent workflow docs prioritize security and concrete exposure risk over broad privacy review.
- Local-only debugging evidence is allowed when needed to prove root cause, while committed/persisted/uploaded/user-facing/provider-facing surfaces still protect secrets and sensitive data.
- Text-only docs verification passes.

## Scope

- In scope: root `AGENTS.md`, workflow/security prompt docs, core logging invariant, and this plan/ledger.
- Out of scope: code behavior, tests, scripts, app/package runtime docs unless directly needed for agent guidance.

## Constraints

- Technical constraints: keep rules simple; avoid adding a debug-mode framework or a matrix of exceptions.
- Product/process constraints: preserve privacy guardrails and unrelated active coordination rows.

## Risks and mitigations

1. Risk: Overly verbose instructions make agents slower.
   Mitigation: Narrow existing rules instead of adding a new process layer.

## Tasks

1. Read required repo routing docs.
2. Update `AGENTS.md` bug-investigation and security/privacy hard rules.
3. Simplify workflow routing and review prompts toward security/concrete exposure.
4. Read back touched docs and run required fast-path verification.
5. Close plan and commit scoped docs/process change.

## Decisions

- Use existing rule locations; do not introduce new workflow machinery.

## Verification

- Commands to run: read back touched docs; `pnpm typecheck`.
- Expected outcomes: touched docs contain the root-cause proof requirement and reduced privacy-review burden; typecheck passes or any failure is reported with scope.
Completed: 2026-06-02
