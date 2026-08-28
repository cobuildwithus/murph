---
title: "Hosted-local runner cleanup leaves anonymous Docker resources"
severity: "minor"
---

Interrupted hosted-local sessions could leave stopped runner containers, attached anonymous volumes, and generated runner images. The startup path had no safe best-effort cleanup for these resources, so repeated runs consumed local storage until manual cleanup.
