Run an architecture review for Murph.

Focus on the current data model, package boundaries, internal APIs, and overall code structure.

Prioritize:
- places where the same concept, state, or invariant is represented multiple ways across contracts, core, query, CLI, web, or hosted layers
- abstractions that increase coupling, widen blast radius, or force changes to ripple across too many packages
- orchestration code that owns too many responsibilities instead of composing smaller seams
- generic helpers, shared types, or "manager" layers that hide ownership and make behavior harder to reason about
- opportunities to simplify the data model or reduce concept count without weakening Murph's core file-native and canonical-write constraints
- refactors that would make the system easier to test, extend, and maintain over the next few years

For each recommendation:
- cite the concrete files, symbols, and architectural seam involved
- explain the current complexity cost or maintenance risk
- describe the simpler target shape in concrete terms
- suggest an incremental refactor path rather than a rewrite when possible
- call out the main risk if the refactor is done poorly

Constraints:
- ground recommendations in the code that exists today, not generic best practices
- prefer high-leverage simplifications over style-only cleanups
- do not recommend framework churn or speculative platform rewrites unless the current code clearly justifies it
- respect Murph's file-native architecture and trust boundaries unless you can show a simpler design that preserves those invariants

Output:
- group findings into `high leverage now`, `worth planning`, and `keep as-is`
- within each group, order findings by expected payoff in long-term simplicity and composability
- be explicit when a messy-looking seam is actually carrying an important boundary and should stay


Patch-file output:
- Please return your final response as a single `.patch` file attachment with a `.patch` filename rather than as a normal prose review.
- Put all actionable fixes into one unified diff that we can download and apply directly.
- Limit the patch to concrete changes that fit this review scope, and keep the diff self-contained.
- If there are important residual concerns that you did not change, list them briefly outside the patch.
- If you find no actionable issues, say so explicitly instead of inventing a patch.
