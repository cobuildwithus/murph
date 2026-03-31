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

Output:
- group findings into `split now`, `worth planning`, and `keep together`
- within each group, order findings by expected payoff in composability and maintainability
- be explicit about the main seam or responsibility boundary driving each recommendation


Patch-file output:
- Please return your final response as a single `.patch` file attachment with a `.patch` filename rather than as a normal prose review.
- Put all actionable fixes into one unified diff that we can download and apply directly.
- Limit the patch to concrete changes that fit this review scope, and keep the diff self-contained.
- If there are important residual concerns that you did not change, list them briefly outside the patch.
- If you find no actionable issues, say so explicitly instead of inventing a patch.
