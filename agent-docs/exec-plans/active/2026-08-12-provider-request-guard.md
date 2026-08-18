# Simplify the external provider request guard

Status: active
Created: 2026-08-12
Updated: 2026-08-17

## Goal

Keep one small CI rule: SDK-backed registered providers must not gain arbitrary
raw HTTP call sites. Unavoidable raw transport belongs to a short, exact owner
registry.

## Scope

- In scope: the guard, focused tests, package wiring, and truthful durable docs.
- Out of scope: provider migrations and runtime request/response validation.
- No production call-site change is required by this redesign.

## Requirement-level redesign

The earlier implementation grew into a second compiler: it attempted to infer
effective values through aliases, mutation, defaults, object spreads, helper
returns, and many JavaScript expression forms. Each ReviewGPT round found a new
provenance edge, so tactical fixes increased the surface they had to secure.

The replacement deliberately enforces ownership rather than semantic equivalence
to every provider SDK:

- Babel parser + `@babel/traverse` provide syntax and lexical bindings.
- A provider registry supplies hosts, identifiers, SDK modules, and whether an
  official SDK is required.
- A raw-owner registry supplies exact file, enclosing function, provider,
  purpose, one-call limit, and required SDK import. Existing raw provider
  boundaries remain explicit migration debt rather than forcing runtime edits
  into this tooling PR.
- Direct fetch/Node HTTP/HTTPS/Undici calls at registered provider boundaries
  fail unless an exact owner covers them.
- Static same-origin calls and providers with no verified TypeScript SDK are
  outside the ban.
- Runtime code remains authoritative for URLs, payloads, headers, responses,
  retries, timeouts, bytes, and credentials.
- This is a maintainability/convention guard, not an adversarial security
  sandbox; its documented blind spots are intentional.

Target: under 2,000 combined guard-and-test lines and no guard-motivated
production rewrites.

## ReviewGPT ledger

All accepted findings below were reproduced. “Complexity” describes the effect
of the tactical fix on the old implementation.

| Round | What ReviewGPT found | Decision | Complexity |
| --- | --- | --- | --- |
| 1 | Presigned safety, lexical fetch aliases, and SMART/FHIR provider-evidence gaps. | Accepted. | Added transport and exception cases. |
| 2 | Provider evidence and exceptions used parallel syntax-specific owners. | Accepted a shared-facts retrospective. | Large redesign, still net growth. |
| 3 | xAI effective-value overrides, direct CommonJS calls, and unproved same-origin spellings. | Accepted. | Added effective-value checks. |
| 4 | TypeScript import-equals, destructured parameter shadows, computed origins, and injected fetch targets escaped. | Accepted. | Expanded binding census. |
| 5 | Diagnostic retry found assigned namespaces, property types, fetch targets, and presigned spreads; valid retry found nested destructuring, tuple spreads, and redundant generic exceptions. | Accepted; deleted generic runner/SMART exception owners. | Mixed: more provenance, some deletion. |
| 6 | Defaults, chronological assignments, forwarding wrappers, and mutable xAI declarations escaped. | Accepted. | Added chronology/wrapper logic. |
| 7 | SDK adapter provider evidence, later assignments, and `.call`/`.apply` provenance escaped. | Accepted; moved AgentMail transport to its owner. | Added call-shape logic. |
| 8 | Import/helper boundaries lost provider identity, later overrides were ignored, and aliased call/apply forwarding lost transport identity. | Accepted. | Added more provenance state. |
| 9 | SDK bridge authority and dynamic imports were under-closed. | Accepted exact imports/consumers/digests and dynamic-import handling. | Major registry and digest complexity. |
| 10 | Full-snapshot audit found no reachable High/Critical issue. | Accepted PASS. | No fix. |
| 11 | Diagnostic and valid retries found destructured globals, pre-bound args, generic wire contracts, dynamic fetch imports, namespace aliases, closed-member bound calls, a Linq normalizer capability leak, and PR disclosure drift. | Accepted code findings and disclosure update. | Large alias/member composition growth. |
| 12 | Definitive container aliases and destructuring could lose provider transport or URL facts. | Accepted; deleted one declaration-time fallback. | More shared binding structure. |
| 13 | Conditional alias assignments disagreed with definitive-only mutation roots. | Accepted requirement-level set-valued roots. | Added root-set machinery. |
| 14 | One transport consumer still chose only the latest value; property projection ignored member mutations. | Accepted. | Added multi-value/effective-property reads. |
| 15 | Reference-valued members in closed aggregates lost runtime object identity. | Accepted. | Added alias observation state. |
| 16 | Dynamic nested member segments discarded the live root. | Accepted. | Added opaque-path handling. |
| 17 | Parameter, direct-call, and `this` roots bypassed that opaque-path boundary. | Accepted. | Expanded root grammar. |
| 18 | Awaited and conditional/logical/sequence targets repeated the same gap. | Accepted a single target-expression resolver. | Consolidated owners, but remained large. |
| 19 | Imported namespace alternatives lost transport kinds; same-file URL helper returns were not followed. | Accepted. | Added set-valued namespaces and helper-return inference. |
| 20 | Diagnostic retry found parameter-default and conditional-write gaps; valid review found nested defaults, opaque/spread inputs, and local arrows/functions. | Accepted a defaults/callable retrospective. | Added parameter projection and callable grammar. |
| 21 | Helper values were still split across variable, parameter, callable, and computed-property rules. | Accepted consolidation into one helper-value resolver. | Reduced owners but expanded state/tests. |
| 22 | Block function precedence and call-time mutation observation were wrong. | Accepted. | Added lexical owner and reference-position state. |
| 23 | Root and property defaults used inconsistent provenance. | Accepted one default transition. | Added another position dimension. |
| 24 | Call-produced aggregates were projected before helper-return expansion. | Accepted by moving expansion into the resolver. | More resolver responsibility. |
| 25 | Return-local aggregate aliases could still lose provenance. Model confirmation was unknown, so the run was diagnostic and requested another retrospective. | Accepted as evidence that the custom engine should be removed; rejected another tactical patch. | Triggered the complexity collapse. |
| 26 | The production source census, file-level provider gate, and AST owner analysis disagreed, skipping current `.call`, generic-path, nullish, and conditional owners; the third exception registry and configurable one-call fields were unused. | Accepted the coverage and deletion findings; rejected expanding this tooling PR to delete inert baseline comments from production files. | Deleted the duplicate gates, third registry, and repeated fields; added only two direct expression cases and four existing-owner records, for a net ten-line guard/test deletion. |

Two later simplification-design attempts on Phlebas failed before review because
GitHub GraphQL returned HTTP 503; they produced no ReviewGPT findings and are not
counted as rounds. Two exact-head round-26 staging attempts on Mountain and
Hercules likewise failed before submission on browser socket timeouts and are
not counted. The substantive Phlebas round completed with a captured
`gpt-5-6-pro` model slug while its response text reported model confirmation as
unknown; its concrete findings were reproduced and corrected without restoring
the old provenance engine.

## Tasks

1. [x] Reframe the requirement as exact raw-transport ownership.
2. [x] Replace custom provenance analysis with Babel traversal and registries.
3. [x] Delete guard-driven production workarounds and collapse durable docs.
4. [x] Run focused tests, the production scan, typecheck, diff checks, and
   relevant repository verification.
5. [ ] Commit and push the round-26 correction candidate.
6. [ ] Run a non-Eragon ReviewGPT correction audit with exact-head CI and close
   the plan.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-provider-request-boundaries.test.ts`
- `pnpm provider-requests:guard`
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`
- `pnpm test:diff`
- `git diff --check`
- Exact-head CI and ReviewGPT.

## Current evidence

- Compact suite: 22 focused tests pass, including the production source census.
- Guard plus tests: 1,579 lines, down from approximately 11,400 on the prior
  PR head.
- Production workarounds from the old analyzer are removed from the PR.
- The production scan, repo-tools TypeScript compilation, frozen lockfile,
  dependency policy, doc gardening, and `git diff --check` pass.
- `pnpm test:diff` re-proved every guard-owned gate, then reported four
  unchanged workspace-boundary violations from the PR base and two unrelated
  90-second CLI test timeouts under shared-host contention. The run was stopped
  after 25 minutes because those existing failures made a local aggregate pass
  impossible; exact-head CI remains authoritative.
