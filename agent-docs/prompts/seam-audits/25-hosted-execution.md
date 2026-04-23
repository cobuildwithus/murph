---
description: One-pass seam audit prompt for @murphai/hosted-execution
---

# `@murphai/hosted-execution`

## Scope

- `packages/hosted-execution/src/{contracts.ts,auth.ts,routes.ts,env.ts,builders.ts,observability.ts,side-effects.ts,email-ingress.ts,hosted-email.ts}`
- `packages/hosted-execution/src/parsers/**/*.ts`
- `packages/hosted-execution/README.md`
- directly coupled `packages/hosted-execution/test/**`

## Focus

- shared ingress/run/cursor/status/auth/route contracts for hosted execution
- signed callback canonicalization, `finalizeRequired` semantics, and vendor-neutral env shaping
- accidental ownership creep into app-local topology, worker-private routes, or device-runtime specifics

## Prompt

Review the `@murphai/hosted-execution` seam using the scope above. Focus on concrete bugs in shared hosted-run contracts, signed-request canonicalization, route builders, side-effect codecs, hosted email ingress payloads, and any mismatch that could desync hosted web and Cloudflare execution. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep this package limited to the shared transport seam instead of app-local control policy. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
