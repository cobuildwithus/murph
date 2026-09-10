# Retire redundant browser surfaces

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and invariant

Retire Overview, History, and experimental Labs browser pages. Preserve canonical
health data, Home, Journal, Patterns, ordinary Strava, Clinical Records, custom
inference, group missions, and conversational labs discovery.

## Ownership and evidence

The retired clients render Browser Vault projections or call a browser-only Labs
API. Home, Journal, Patterns, and experiment views retain access to the underlying
records. The signed Labs callback shares the stateless Junction service and
remains the assistant's discovery path. No production data is mutated.

## Product UX

Product change. Old Overview links lead to Home, History links to Journal, and
Labs links to Home. Existing destination authentication and consent remain the
owners of private access. Remove the browser-only Labs API and its tests while
retaining signed callback tests. No new page presentation is introduced.

## Tasks and proof

1. Remove dedicated clients and redundant layouts; redirect legacy bookmarks.
2. Remove obsolete tests and references; preserve destination/provider tests.
3. Run redirect, dashboard/provider, and signed Labs callback proof, Web typecheck,
   complexity, and applicable changelog checks; review privacy and full diff.
4. Close plan, open PR, and run required exact-head CI and final review.

## Deployment

Normal Web deployment. No stored data or cross-plane schema changes. Old open
Labs tabs lose their browser API; reload returns to Home. The assistant callback
continues using the unchanged service. No rollback or deployment is requested.

## Verification

Completed source retirement and candidate review. Focused Web proof passed:
115 redirect, dashboard/provider, and signed callback tests; 46 changelog tests.
Query replica proof passed (26 tests after correcting one obsolete export
assertion), plus Query and Web typechecks. Complexity ratchet passed with no
changed-source hotspots. Privacy/diff check passed. Browser automation was
unavailable; redirects use the actual Next permanentRedirect implementation and
existing destination components are unchanged. PR exact-head CI and ReviewGPT
remain final external gates.
Completed: 2026-09-10
