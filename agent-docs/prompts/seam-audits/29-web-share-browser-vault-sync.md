---
description: One-pass seam audit prompt for apps/web share, browser-vault, vault-sync, and experiment composition seams
---

# `apps/web` Share, Browser Vault, Sync, And Experiment Composition

## Scope

- `apps/web/src/lib/{hosted-share/**,browser-vault/**,vault-sync/**,experiments/**,health-commons/**}`
- `apps/web/app/api/browser-vault/session/route.ts`
- `apps/web/app/api/hosted-share/**`
- `apps/web/app/api/settings/vault-sync/**`
- `apps/web/app/api/vault-sync/agent/**`
- `apps/web/app/api/internal/hosted-execution/{share/**,vault-sync/**}`
- `apps/web/app/(dashboard)/experiments/**`
- `apps/web/app/share/[shareCode]/**`
- directly coupled `apps/web/test/**`

## Focus

- encrypted share payloads and acceptance flow
- browser-vault private overlay vs public protocol composition
- vault-sync session/import behavior and experiment detail composition boundaries

## Prompt

Review the share, browser-vault, vault-sync, and experiment-composition seam in `apps/web` using the scope above. Focus on concrete bugs in encrypted share payload handling, acceptance or claim flow, browser-vault privacy boundaries, vault-sync session semantics, and any UI/data-composition path that copies public protocol truth into private state or exposes private run data incorrectly. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep share, private overlay, and sync responsibilities sharply separated. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
