Run a code quality audit for Murph.

Prioritize:
- unnecessary complexity
- stale or misleading abstractions
- brittle branching and error handling
- naming or type choices that hide intent

Recommend behavior-preserving simplifications when they materially improve clarity.

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
