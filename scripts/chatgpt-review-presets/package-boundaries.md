Run a package-boundary and dependency-boundary audit for Murph.

Focus on the current workspace package graph, public entrypoints, and ownership seams across packages, apps, and shared helpers.

Prioritize:

- direct or indirect circular dependencies, including cycles hidden behind public subpaths, compatibility shims, or helper packages
- places where package concerns are mixed and one package is carrying logic that clearly belongs to a different owner
- sibling imports, re-exports, or shared helpers that blur ownership and make changes ripple across too many packages
- domain or runtime logic that lives in CLI/app packages even though multiple consumers need it from a lower shared owner
- public entrypoints that leak internals or force callers to depend on the wrong package boundary
- temporary compatibility layers, wrappers, or aliases that can now be hard-cut because the current architecture no longer needs them
- package graphs that are technically acyclic but still tightly coupled because the same concept is represented or coordinated from multiple owners

For each concrete change you choose to make:

- cite the files, packages, and boundary seam involved
- explain the current coupling, ownership confusion, or cycle risk
- keep follow-up notes brief when a larger cleanup is warranted but unsafe to land in one patch

Constraints:

- ground recommendations and edits in the repo that exists today, not generic package-design advice
- respect Murph's one-way workspace dependency rule, trust boundaries, and owner-package expectations
- prefer behavior-preserving boundary cleanups, ownership moves, import tightening, or hard cuts over speculative restructuring

Execution mode:

- inspect package manifests, imports, public entrypoints, and any existing boundary or cycle guards that help verify the issue

Final response contract:

- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
