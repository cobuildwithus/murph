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
- call out the main risk if the refactor is done poorly
- feel free to do larger refactors if you think it is justified

Constraints:

- ground recommendations in the code that exists today, not generic best practices
- prefer high-leverage simplifications over style-only cleanups
- respect Murph's file-native architecture and trust boundaries unless you can show a simpler design that preserves those invariants

Final response contract:

- Return a concise plain-text review with the highest-value architecture recommendations from this pass.
- For each recommendation, cite the concrete files, symbols, and seam involved, explain the maintenance risk, and recommend the smallest safe follow-up.
- Prefer recommendations that would land as non-Markdown repo changes under code, tests, scripts, or config. Do not spend the pass on docs-only recommendations unless they clearly support a concrete code-side refactor.
- If a doc update would help explain a code refactor, mention it only alongside that concrete code-side recommendation, not as a standalone output.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable non-Markdown repo change, return a short plain-text summary saying so.
