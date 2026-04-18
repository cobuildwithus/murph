Run a code quality audit for Murph.

Prioritize:
- unnecessary complexity
- stale or misleading abstractions
- brittle branching and error handling
- naming or type choices that hide intent

Recommend behavior-preserving simplifications when they materially improve clarity.

Final response contract:
- Return a concise plain-text review with the highest-value code-quality issues or simplifications from this pass.
- For each item, cite the concrete files or symbols involved, explain the clarity or maintenance problem, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
