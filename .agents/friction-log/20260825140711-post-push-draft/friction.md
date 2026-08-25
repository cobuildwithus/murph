---
title: 'Post-push draft reset cannot access pull request'
severity: 'major'
---

The Pull Request Head Draft Reset workflow reaches the exact synchronized pull request, then GitHub rejects its authenticated pull-request lookup with Resource not accessible by integration. The pull request stays Ready, so ready_for_review-gated required workflows do not run on the new head. The task owner must manually convert the exact head to draft and mark it Ready again to restore the intended CI trigger.
