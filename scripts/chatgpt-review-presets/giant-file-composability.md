Run a composability review for giant files in Murph.

Focus on files that have become too large, too mixed in responsibility, or too hard to navigate because multiple seams live together.

Prioritize:

- files that own several distinct responsibilities and would be easier to reason about as smaller modules
- files where unrelated exports, helper clusters, or execution paths are coupled only because they happen to live in one place
- files whose size or branching depth makes local changes risky because readers must keep too much context in mind
- extraction opportunities that would create clearer ownership boundaries, smaller test surfaces, and more reusable seams
- incremental splits that reduce cognitive load without introducing speculative abstractions or "utils" grab-bags

For each recommendation:

- cite the concrete file and symbols that should move or separate
- explain why the current file shape hurts composability or maintenance
- describe the smaller target module boundaries in concrete terms
- suggest an incremental extraction path that can land safely in follow-up patches
- call out when a large file should stay intact because its size reflects a real boundary rather than accidental sprawl

Constraints:

- ground recommendations in the code that exists today, not generic file-length advice
- prefer responsibility boundaries over arbitrary line-count thresholds
- do not recommend splitting a file unless the new module seams would be clearer than the current shape
- avoid replacing one giant file with a web of vague helpers or pass-through re-exports
- respect existing package and trust boundaries unless the current file shape clearly violates them

Final response contract:

- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
