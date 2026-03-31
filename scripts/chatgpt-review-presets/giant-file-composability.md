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

Execution mode:
- do not stop at prose recommendations if you can safely land the change in code
- choose the smallest high-leverage set of concrete file changes that fit this review scope
- prefer self-contained extractions or seam cleanups over broad speculative rewrites

Patched-file output:
- Return downloadable `.patched` code-file attachments instead of a prose review document.
- For each changed repo file, attach one full replacement file with a flat download-safe filename: replace each `/` in the repo-relative path with `__SLASH__`, keep the original basename and extension, then append `.patched`.
- Example filename: `packages__SLASH__cli__SLASH__src__SLASH__research-runtime.ts.patched`.
- Each `.patched` attachment must contain the complete post-change file contents for that file, not a diff.
- Do not attach a `.md` review, `.patch` file, or unified diff unless the user explicitly asks for one.
- Keep the changed file set small and self-contained within this composability pass.
- If there are important residual concerns you did not change, list them briefly outside the file attachments.
- If you find no safe actionable changes, say so explicitly in a short plain-text reply and attach nothing.
