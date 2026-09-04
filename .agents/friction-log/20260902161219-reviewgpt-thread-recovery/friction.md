---
title: 'ReviewGPT thread recovery wedges on duplicate conversation tabs'
severity: 'minor'
---

## Expected Behavior

Thread wake, export, diagnostics, and attachment download should select one responsive tab for a conversation and complete or fail within their documented timeout.

## Current Behavior

When the managed browser contains two tabs for the same conversation, one responsive and one unresponsive, wake remains at its initial checked-once state while the process stays alive. Direct export and diagnostics also wait indefinitely. After the unresponsive duplicate is closed, export succeeds, but thread download can still report no available attachment buttons even though the final assistant turn contains an enabled behavior button. Clicking that verified button through the browser protocol downloads the artifact immediately.

## Possible Solution

Select conversation targets deterministically by a bounded responsiveness probe, ignore or close stale duplicates, and have export and diagnostics enforce their own bounded timeout. Reuse the exported assistant-turn and behavior-button identity during download instead of resolving the button again through a selector that can return an empty set.

## Minimal Reproducible Example

1. Open the same completed ReviewGPT conversation in two managed-browser tabs.
2. Make one tab unresponsive while the other still renders the final response and attachment button.
3. Run thread wake or thread export for that conversation.
4. Observe the command remain at its first check.
5. Close the unresponsive duplicate and export again.
6. Run thread download by artifact index or exact label and observe an empty available-button list.
7. Click the enabled final-turn behavior button directly and observe the file download complete.

## Context

This blocked recovery of a scoped production patch for several hours. Manual target de-duplication and a direct browser-protocol click recovered the hash-verified artifact without regenerating it.
