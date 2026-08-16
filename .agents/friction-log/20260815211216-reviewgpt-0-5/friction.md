---
title: 'ReviewGPT 0.5.131 submit verification reports a retained attachment as lost'
severity: 'minor'
target: 'cobuildwithus/review-gpt'
---

On two lanes in a row, a completion-specialists send reached 'Draft attachments confirmed (attached=1/1)' and auto-submitted, then failed with 'Submitted user turn did not retain every expected attachment (attached=0/1)' and exit 1. CDP inspection of both accepted threads showed the submitted user turn DID retain the ZIP (zip filename chip rendered, model began reading it), so the post-submit attachment check is matching stale or renamed DOM and the CLI abandons a healthy run. Recovery each time: thread export polling per the documented lost-capture path. Worked on 0.5.126; first seen minutes after updating to 0.5.131 (which changed guard timing options), on both Hercules and Phlebas.
