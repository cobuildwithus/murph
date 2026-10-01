# Preserve outbound storage error boundaries and diagnose crypto stalls

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Preserve the existing safe HTTP failure boundary for asynchronous outbound storage failures; establish the cause of separate crypto stalls or add only the missing diagnostic signal.

## Success criteria

- Reproduce async storage failures escaping the route catch, then prove safe HTTP responses with unchanged successful storage and authority checks.
- Preserve upload deadlines, immutable bytes, fencing, and durable job recovery. Add no retry layer or durable state.
- Distinguish proven defects from crypto lifecycle hypotheses using synthetic workerd diagnostics and bounded aggregate runtime evidence.
- Focused tests, affected typecheck, parent review, exact-head CI and final ReviewGPT pass.

## Scope and ownership

The outbound route owns error conversion; the existing crypto envelope cache owns verified encrypted cache data. Production implementations and substantive revisions are authored by ReviewGPT. Parent owns investigation, reproduction, validation and delivery. Production remains read-only. No bug-fix merge or deployment is authorized for this follow-up.

## Product UX

Internal transport behavior: callers receive the existing structured HTTP error rather than a socket disconnect. No UI, assistant behavior, freshness guarantee, or recovery policy changes. Successful imports and stale-fence rejection remain unchanged. Exact-resource recovery requires separate production evidence after deployment.

## Tasks

1. Apply the author-provided minimal storage await correction and regression tests.
2. Probe actual ContainerProxy and crypto context lifetimes; add metadata-only observability only if the cause remains unproved.
3. Run focused proof and typecheck, inspect the candidate, close this plan and commit.
4. Open a scoped PR, run ReviewGPT concurrently with CI, resolve authorized findings.

## Decisions

- Do not expand fast retry admission or add storage retry owners for long vendor failures.
- Concurrent promise reuse is a hypothesis, not a demonstrated fix target; earlier synthetic concurrency, cancellation, service-binding and real-crypto tests passed.
- Reuse existing Frog entries for automation checkout admission and audit packaging output overflow. The author-only packaging wrapper preserves the canonical full snapshot and exit status while summarizing expected exclusion warnings; it is private diagnostic scaffolding.

## Verification

- Exact ReviewGPT-authored boundary, privacy and diagnostic patches applied; parent inspected all changes.
- Route and proxy regression suites, affected Cloudflare typecheck, complexity guard, log guard and documentation drift checks pass. Fresh checkout uses canonical Prisma generation.
- Actual workerd/ContainerProxy with synthetic signed envelopes: five successful concurrent responses, one upstream fetch, exactly four pending-join events containing only bounded metadata. No production hang reproduced.
- Sentinel tests inspect raw emitter properties and actual structured log records, preserving finite R2 original-code metadata and error severity without exception text or identifiers.
- Parent Product UX review: internal-only; success, fencing and typed durable retry contracts preserved. Exact-resource recovery and production improvement remain unproved before deployment.
- Required final ReviewGPT and exact-head CI are tracked with the scoped PR and remain merge-readiness gates. No merge or deployment performed.

## Final decisions

- The outer boundary omits arbitrary exception details from HTTP and log payloads; the existing safe code, summary, error name and stage diagnostics suffice.
- Keep crypto behavior unchanged. The bounded pending-join event is the last-resort missing signal; the observability owner documents its seven-day natural-traffic observation and removal decision.
- Complexity is unchanged: the modified route remains 26; unrelated snapshot hotspots remain untouched. No new abstraction or state owner.
- Changelog is not applicable: this is internal transport correctness and diagnostic attribution with no new recovery policy or proven member freshness improvement.
Completed: 2026-09-17
