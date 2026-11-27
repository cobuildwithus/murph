# Nearby facilities in provider search

Status: completed

Members can search the public directory by ZIP or request one coarse location fix. Keep the existing selection and portal authorization path. Only the search request receives the origin. Measure coverage and preserve name lookup for facilities without a Census match.

Build coordinates offline, filter eligible facilities before portal selection, and negotiate distance with strict browser decoders. Verify origin privacy at the client, HTTP and database boundaries. Test stable ties and deterministic imports.

Validate each weekly candidate against the current artifact. Use the existing main-only GitHub App environment and protected PR merge. Exercise importer failure paths, run actionlint, and leave the implementation PR in draft.

## Results

The pinned 2026 source contains 33,791 public ZCTA points. The refreshed registry contains 97,471 mapped facilities among 100,181. Two full imports were byte-identical.

Seven focused Web suites passed 77 tests. The final ranking, client and importer rerun passed 53 tests. Web typecheck and lint, the complexity guard, actionlint, the 16 KMS owner tests, documentation checks and the source-artifact guard passed.

Read-only policy inspection found no signer binding for the directory workflow. The intake spec gives the one-time main-ref grant. After provisioning, weekly changes open ready PRs and merge normally through branch protection. The implementation PR stays draft.

## Review fixes

The connect page now receives `geolocation=(self)` and every other page keeps it blocked; the records page opens it with a full page load so the permission applies. A connection is bound to its entry's exact endpoint URL, so the refresh holds any endpoint change on an existing entry, path included, every removal and every new entry on an unknown host, and reports them in one GitHub issue. One shared rule runs in the importer, the dependency-free publish job and the required release plan. Regenerated against main, the directory keeps 49 current endpoints (30 host and 19 path changes), keeps 5 entries missing upstream, leaves out 13 new-host entries and publishes 62 new entries on known hosts. It carries 1,308 brands and 97,618 facilities, 94,457 of them mapped, in 11.4 MB. Coordinates keep three decimals and the unused upstream facility id is gone, along with street lines that repeat the facility name. Only search loads the ZIP table. Facility ranking runs only for relevance tiers that reach the results and for portal siblings; 798 old and new searches matched exactly.
Updated: 2026-11-26
Completed: 2026-11-26
