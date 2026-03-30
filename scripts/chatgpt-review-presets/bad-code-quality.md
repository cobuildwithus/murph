Run a code quality audit for Murph.

Prioritize:
- unnecessary complexity
- stale or misleading abstractions
- brittle branching and error handling
- naming or type choices that hide intent

Recommend behavior-preserving simplifications when they materially improve clarity.


Patch-file output:
- Please return your final response as a single `.patch` file attachment with a `.patch` filename rather than as a normal prose review.
- Put all actionable fixes into one unified diff that we can download and apply directly.
- Limit the patch to concrete changes that fit this review scope, and keep the diff self-contained.
- If there are important residual concerns that you did not change, list them briefly outside the patch.
- If you find no actionable issues, say so explicitly instead of inventing a patch.
