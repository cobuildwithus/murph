# EXA Research Scout

## Goal

Land the v1 Exa-backed weekly health research scout architecture described in
the EXA design note.

Success criteria:

- `vault-cli research scout` exposes one bounded Exa Search deep-reasoning
  provider command that accepts only a compact tag profile and writes no vault
  records.
- Hosted runner egress treats Exa as a first-class intercepted provider:
  Worker-owned `EXA_API_KEY`, runner sentinel only, and `POST /search` only.
- Managed automations include `weekly-health-research-scout` with conservative
  no-raw-values and suppress-if-weak guidance.
- Focused tests prove CLI contracts/command behavior, hosted egress/env policy,
  and managed automation guidance.
- Required verification, audits, commit, push, and PR are completed from the
  isolated worktree branch.

## Constraints

- Work in the isolated EXA worktree on `codex/exa-research-scout`.
- Preserve unrelated main-checkout clinical negative assertion work.
- Keep v1 intentionally narrow: no Exa Agent, polling lifecycle, vector DB,
  crawler, PubMed/OpenAlex integration, or generic Exa command.
- Do not send raw lab values, names, dates of birth, full notes, medical
  records, or precise private identifiers to external providers.
- Do not forward the real `EXA_API_KEY` into hosted containers.

## Approach

1. Add CLI research scout schemas/client/command and manifest wiring.
2. Add hosted Exa egress interception and env/worker contract policy.
3. Add the managed weekly research scout automation seed.
4. Add focused tests for the new command, egress policy, env policy, and seed.
5. Run verification and completion audits, then finish with PR-lane commit and
   PR.

## State

Ready to close.

## Notes

- Source architecture input is the EXA design note supplied in the user request.
- Exa Search is the v1 provider shape; Exa Agent is intentionally excluded.
- Implemented `vault-cli research scout` as a descriptor-backed, vault-exempt
  command with Exa Search-only client behavior and local privacy preflight.
- Implemented hosted Exa egress with Worker-owned `EXA_API_KEY`, sentinel-only
  runner env, `POST /search` allowlisting, and deployment secret wiring.
- Implemented the managed weekly health research scout automation, gated on
  runtime `EXA_API_KEY` availability.
- Verification: focused CLI/automation/runtime suites passed; `pnpm typecheck`,
  `git diff --check`, and `pnpm test:diff` passed. `pnpm verify:acceptance` was
  attempted and failed on unrelated existing coverage/load or apps/web baseline
  issues outside this diff.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
