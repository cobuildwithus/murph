Run a targeted data-structure and data-model review for Murph.

Use this framing:
"Run a pass over our data structures/data model to see how we can improve them and make them more composable, simple, and scalable."

Focus on the current shapes that carry real product meaning across contracts, core, query, CLI, web, hosted execution, and assistant/runtime layers.

Prioritize:

- concepts that are modeled in multiple incompatible or partially overlapping ways
- data structures that are harder to compose than they need to be because ownership is split across too many packages or helper layers
- record shapes, APIs, or state models that are carrying more optionality, branching, or special cases than the system actually needs
- places where simple operations require too much orchestration because the model is not normalized around a clear owner
- seams where adding one more use case would likely force copy/paste, one-off adapters, or parallel representations
- opportunities to reduce concept count, collapse duplicate representations, or move toward smaller reusable building blocks without weakening Murph's canonical-write and trust-boundary rules
- cases where the current shape is already simple and composable enough and should be kept as-is

For each recommendation:

- cite the concrete files, symbols, and model seam involved
- explain the current complexity cost, scalability risk, or composability problem
- describe the simpler target shape in concrete terms
- call out the main tradeoff or failure mode if the refactor is done poorly

Constraints:

- ground recommendations in the code and data flows that exist today, not generic system-design advice
- prefer high-leverage model simplifications over naming/style-only cleanup
- respect Murph's file-native architecture, canonical write boundaries, and trust boundaries unless you can show a simpler design that preserves them

Final response contract:

- Return a concise plain-text review with the highest-value data-model recommendations from this pass.
- For each recommendation, cite the concrete files, symbols, and model seam involved, explain the composability or scalability problem, and recommend the smallest safe follow-up.
- Prefer recommendations that would land as non-Markdown repo changes under code, tests, scripts, or config. Do not spend the pass on docs-only recommendations unless they clearly support a concrete code-side refactor.
- If a doc update would help explain a code refactor, mention it only alongside that concrete code-side recommendation, not as a standalone output.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable non-Markdown repo change, return a short plain-text summary saying so.
