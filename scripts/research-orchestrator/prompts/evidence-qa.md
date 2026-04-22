{{SHARED_HEADER}}

TASK: Evidence QA blocker review.

Goal:
Block unsupported, overstated, miscited, or badly classified claims before landing.

Review:
- protocol package draft from: {{PROTOCOL_PACKAGE_DRAFT_SOURCE}}
- claims from: {{CLAIMS_SOURCE}}
- researchLandscape
- source pages
- atomic findings from: {{ATOMIC_FINDINGS_SOURCE}}

Output:
1. Unsupported claims
2. Overstated claims
3. Claims using adjacent evidence as direct evidence
4. Missing null or mixed evidence
5. Missing important source pages
6. Source keys that do not exist
7. Findings whose claimUse classification should change
8. Required edits, with exact replacement wording

Rules:
- Be skeptical.
- Prefer downgrading claim strength over deleting useful nuance.
- Do not add new claims unless they cite source keys.
