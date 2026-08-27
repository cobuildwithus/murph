# Close Frog #2337 with a local production-secret stop rule

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Close Frog issue #2337 with one durable rule: local agents treat production
  secret values as unavailable and stop for user discussion before work that
  would require them.

## Success criteria

- Root agent policy and the durable security owner state the stop boundary.
- Active maintenance guidance no longer claims a local or GitHub-runner
  production execution path for the affected secret-dependent scripts.
- Focused proof rejects production `vercel env run` instructions and pins the
  stop-and-discuss contract.

## Scope

- In scope: agent/security policy, affected Web operator docs, CLI help text,
  focused documentation guards, and PR/issue closure metadata.
- Out of scope: production secret access, production data, a hosted maintenance
  endpoint, workflow changes, duplicate credentials, or any production run.

## Constraints

- Technical constraints: keep all existing dry-run, batching, drain, privacy,
  and convergence semantics without claiming an executable production owner.
- Product/process constraints: the user explicitly chose discussion over a new
  auth/runtime surface; issue closure occurs only when the PR merges.

## Risks and mitigations

1. Risk: agents may infer an undocumented production path from script examples.
   Mitigation: label examples local/test-only and explicitly require stopping
   before production-secret-dependent implementation or execution.

## Tasks

1. Add the canonical local production-secret stop rule.
2. Remove the unsupported protected-workflow ownership claims.
3. Update focused policy/help regression coverage.
4. Run docs checks, focused tests, typecheck, ReviewGPT, and exact-head CI.

## Decisions

- Prefer one prompt-level hard rule plus one durable security explanation over a
  new execution service or credential path.

## Verification

- Commands to run: focused production-migration-guard Vitest, Web typecheck,
  docs drift/gardening, `git diff --check`, privacy scan, routed ReviewGPT and CI.
- Expected outcomes: all applicable checks pass; no production operation or
  secret read occurs.
Completed: 2026-08-26
