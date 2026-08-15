---
title: 'Sections design catalog cold compile blocks frontend proof for several minutes'
severity: 'minor'
---

## Expected Behavior

After the documented generated artifacts are prepared, opening the Sections design catalog in a fresh sanctioned worktree should reach the synthetic study quickly enough for the required desktop and mobile proof loop.

## Current Behavior

The first Sections request spends several minutes discovering workflow directives and then several more minutes compiling the design route. In repeated clean reproductions, 10-minute and 15-minute browser requests expired while the server was still compiling; a retained readiness request finally completed after 15.9 minutes. Shorter browser and command timeouts therefore fail even though the server is still making progress.

## Possible Solution

Split the sections catalog into lazily loaded study groups, cache workflow-directive discovery across the dev process, or provide a focused proof route that still renders the registered production study without compiling every unrelated section.

## Minimal Reproducible Example

1. Create a fresh sanctioned task worktree and install dependencies.
2. Generate the Health Commons and Prisma artifacts required by Hosted Web.
3. Start the documented app-local Next development server with an isolated build suffix.
4. Request the Sections design catalog and observe the cold compile before the first successful response.

## Context

The requested synthetic study rendered correctly after compilation and subsequent requests completed in tens of seconds. This is repository-required frontend-proof friction, not a production runtime report.
