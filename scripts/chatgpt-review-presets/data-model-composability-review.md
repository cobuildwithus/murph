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
- suggest an incremental refactor path instead of a rewrite when possible
- call out the main tradeoff or failure mode if the refactor is done poorly

Constraints:
- ground recommendations in the code and data flows that exist today, not generic system-design advice
- prefer high-leverage model simplifications over naming/style-only cleanup
- do not recommend speculative platform rewrites or broad framework churn unless the current model clearly justifies it
- respect Murph's file-native architecture, canonical write boundaries, and trust boundaries unless you can show a simpler design that preserves them

Execution mode:
- do not stop at prose recommendations if you can safely land the change in code
- choose the smallest high-leverage set of concrete file changes that fit this review scope
- prefer localized model simplifications over broad rewrites

Patched-file output:
- Return downloadable `.patched` code-file attachments instead of a prose review document.
- For each changed repo file, attach one full replacement file with a flat download-safe filename: replace each `/` in the repo-relative path with `__SLASH__`, keep the original basename and extension, then append `.patched`.
- Example filename: `packages__SLASH__cli__SLASH__src__SLASH__research-runtime.ts.patched`.
- Each `.patched` attachment must contain the complete post-change file contents for that file, not a diff.
- Do not attach a `.md` review, `.patch` file, or unified diff unless the user explicitly asks for one.
- Keep the changed file set small and self-contained within this data-model pass.
- If there are important residual concerns you did not change, list them briefly outside the file attachments.
- If you find no safe actionable changes, say so explicitly in a short plain-text reply and attach nothing.
