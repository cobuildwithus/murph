# Runner reservation investigation and native drain inspection

Status: completed

## Outcome

An account can reserve the serving bank, another full candidate bank, retained legacy inventory and smoke simultaneously. A full-size overlap does not fit the observed quota. A temporary smaller member ceiling was explicitly authorized while the full-capacity architecture is investigated. Experimental automatic budget-transfer code was removed; the existing public capacity semantics remain unchanged.

Independent ReviewGPT architecture review recommends preserving exact release banks and separating execution identity from capacity only through a compatible future migration. Automatic transfer requires authoritative closure of previous-release starts; sampled counts alone do not prove that boundary. Drained legacy retirement can reclaim headroom but cannot provide simultaneous full-sized old and new banks under the current quota.

## Protected operation

The private protected maintenance operation changes only the explicitly approved serving ceiling. Its implementation and diagnostic follow-up passed focused/full verification, exact-head CI and final review. Inspection then proved that the application-deployments endpoint returns HTTP 404. No native ceiling change or full runner release is claimed here. A private follow-up switches occupancy to Wrangler's paginated dashboard instance endpoint; its review and production validation remain separate work.

## Public correction

The public inactive-bank drain reader used the same unsupported endpoint. It now follows every dashboard instance page, permits reuse only for empty or entirely stopped native inventory, ignores historical Durable Object records, and preserves waiting for running or unknown state. Failed or malformed pages, repeated tokens, and bounded page/row/deadline exhaustion never authorize reuse. Provider error diagnostics additionally redact the exact opaque cursor and application identity.

The existing deployment provider, admission, namespace fencing, readiness, Worker promotion, receipts and serving capacity remain the owners. No member-process stop, automatic capacity transfer, quota purchase, or local secret access is added. The endpoint correction does not turn a sampled drain check into an atomic start fence.

## Evidence

The endpoint, response fields and continuation token match pinned Wrangler 4.90.0. Source inspection also confirmed versions upload publishes Worker metadata without native application creation or traffic activation in that command path.

The native-provider suite passed 32 tests. The composed staging/deployment suites passed 53 tests. Cloudflare typecheck passed. The complexity guard passed with no hotspots above 20. Parent diff/privacy review passed. Required final ReviewGPT and exact-head CI remain PR gates; protected inspection, the authorized reduction, full release smoke/convergence and workspace-loop recovery still require direct operational proof.

## Product and documentation

Internal deployment tooling only: no assistant prompt, member action, UI, hot reply path or initial model input changed. No public changelog entry is needed. The durable deployment guide now describes complete native-instance pagination. Execution plans remain indexed by the existing active/completed directory entries.
Updated: 2026-09-08
Completed: 2026-09-08
