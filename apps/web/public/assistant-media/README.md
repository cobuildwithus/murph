Assistant media catalog items must be static public image-file URLs.

For v1, catalog item URLs must be HTTPS, domain-hosted, and stable image paths ending in an image extension such as `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, or `.avif`, or Cloudflare Images delivery URLs such as `https://imagedelivery.net/<account-hash>/<image-id>/public`. URLs with credentials, query strings, fragments, localhost hosts, or IP literals are rejected by the assistant runtime.

Place generated catalog images under this public directory, or point at another static public CDN path that follows the same policy.
