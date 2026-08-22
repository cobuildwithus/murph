---
title: 'Route-group metadata images silently 404 the advertised opengraph-image URL'
severity: 'minor'
---

Metadata image file conventions inside a route group emit hash-suffixed production routes (for example /biomarkers/[id]/opengraph-image-1umbqe), while pages that advertise the image via explicit openGraph.images reference the unhashed path, which 404s. Biomarker and experiment unfurls shipped this way and served dead image URLs in production until the routes were moved to ungrouped segments (the /environment card had already quietly adopted that layout). Repository-actionable shape: extend check-og-asset-traces (or the emitted-runtime check) to assert every URL referenced through createMurphOgImageRef resolves to an unhashed entry in app-path-routes-manifest.json, so a grouped metadata image fails the build instead of shipping a broken preview.
