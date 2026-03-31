Murph does not have an onchain griefing model, but liveness still matters.

Review for:
- denial-of-service style workflows
- operations that are easy to wedge or leave half-complete
- expensive or repetitive steps that create operator pain
- failure modes that are hard to recover from safely

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
