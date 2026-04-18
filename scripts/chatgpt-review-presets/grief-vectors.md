Murph does not have an onchain griefing model, but liveness still matters.

Review for:
- denial-of-service style workflows
- operations that are easy to wedge or leave half-complete
- expensive or repetitive steps that create operator pain
- failure modes that are hard to recover from safely

Final response contract:
- Return a concise plain-text review with the highest-value grief-vector or liveness issues from this pass.
- For each item, cite the concrete files or seams involved, explain the failure or operator-pain mode, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
