---
description: One-pass seam audit prompt for @murphai/inbox-services
---

# `@murphai/inbox-services`

## Scope

- `packages/inbox-services/src/inbox-app/{environment.ts,service.ts,bootstrap-doctor.ts,bootstrap-doctor-strategies.ts,promotions.ts,reads.ts,runtime.ts,sources.ts,types.ts}`
- `packages/inbox-services/src/inbox-services/{state.ts,daemon.ts,promotions.ts,parser.ts,query.ts,connectors.ts,shared.ts}`
- `packages/inbox-services/README.md`
- directly coupled `packages/inbox-services/test/**`

## Focus

- inbox app/service orchestration for bootstrap, doctor, promotions, reads, and daemon flows
- runtime-loading and composition boundaries between inboxd, parsers, query, and CLI-facing surfaces
- daemon state/config versioning and connector namespace checks
- accidental duplicate ownership of contracts or promotion logic

## Prompt

Review the `@murphai/inbox-services` seam using the scope above. Focus on concrete bugs in bootstrap/doctor orchestration, promotion wiring, daemon composition, and any place this layer duplicates ownership that should remain in inboxd, parsers, query, or lower runtime helpers. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep this package a thin application/service layer. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
