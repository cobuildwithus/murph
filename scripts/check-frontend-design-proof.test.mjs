import assert from "node:assert/strict";
import test from "node:test";

import {
  isFrontendUiPath,
  validateFrontendDesignProof,
} from "./check-frontend-design-proof.mjs";

const COMPLETE_BODY = `
## Design proof

- Design page: /design?tab=sections#group-usage-funding
- Desktop screenshot: ![Desktop group usage](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile group usage](https://example.test/mobile.png)
`;

test("detects user-facing app and shared component UI paths", () => {
  assert.equal(isFrontendUiPath("apps/web/app/home/page.tsx"), true);
  assert.equal(
    isFrontendUiPath("apps/web/app/(dashboard)/home/home-page-client.tsx"),
    true,
  );
  assert.equal(
    isFrontendUiPath("apps/web/src/components/ui/button.tsx"),
    true,
  );
  assert.equal(
    isFrontendUiPath("apps/web/src/components/charts/chart.css"),
    true,
  );
  for (const extension of [
    "avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp",
  ]) {
    assert.equal(isFrontendUiPath(`apps/web/public/brand/hero.${extension}`), true);
  }
  assert.equal(isFrontendUiPath("apps/web/public/robots.txt"), false);
  assert.equal(isFrontendUiPath("apps/web/app/globals.css"), true);
  assert.equal(isFrontendUiPath("apps/web/app/api/settings/route.ts"), false);
  assert.equal(
    isFrontendUiPath("apps/web/app/design/components-content.tsx"),
    false,
  );
  assert.equal(
    isFrontendUiPath("apps/web/test/hosted-group-funding-page.test.tsx"),
    false,
  );
});

test("passes when the UI diff updates a design catalog and the PR embeds both viewports", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/src/components/hosted-groups/group-usage-funding-card.tsx",
        "apps/web/app/design/sections-content.tsx",
      ],
      prBody: COMPLETE_BODY,
    }),
    {
      errors: [],
      required: true,
      uiPaths: [
        "apps/web/src/components/hosted-groups/group-usage-funding-card.tsx",
      ],
    },
  );
});

test("does not count template comments as Design page route proof", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: `
## Design proof

<!-- Use /design?tab=components or /design?tab=sections. -->

- Design page:
- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must link to `/design?tab=components` or `/design?tab=sections`.",
  ]);
});

test("does not count screenshot lines hidden in HTML comments", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: `
## Design proof

- Design page: /design?tab=components#settings
<!--
- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
-->
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must include a hosted desktop screenshot from the design page.",
    "The Design proof section must include a hosted mobile screenshot from the design page.",
  ]);
});

test("does not count a Design proof section hidden in an HTML comment", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: `
## Summary

Settings changed.

<!--
## Design proof

- Design page: /design?tab=components#settings
- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
-->
`,
  });

  assert.deepEqual(result.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);
});

test("treats an unclosed HTML comment as hidden through the end of the PR body", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: `
## Summary

Settings changed.

<!--
## Design proof

- Design page: /design?tab=components#settings
- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
`,
  });

  assert.deepEqual(result.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);
});

test("reports every missing frontend design proof requirement", () => {
  const result = validateFrontendDesignProof({
    changedPaths: ["apps/web/app/settings/page.tsx"],
    prBody: "## Summary\n\nSettings changed.",
  });

  assert.equal(result.required, true);
  assert.deepEqual(result.errors, [
    "Update the design page component catalog or sections catalog for this frontend UI change.",
    "Add a `## Design proof` section to the pull request body.",
  ]);
});

test("requires a design route plus hosted desktop and mobile images", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/groups/fund/[joinCode]/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: `
## Design proof

- Design page: /settings
- Desktop screenshot: local-only.png
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must link to `/design?tab=components` or `/design?tab=sections`.",
    "The Design proof section must include a hosted desktop screenshot from the design page.",
    "The Design proof section must include a hosted mobile screenshot from the design page.",
  ]);
});

test("skips backend-only and design-catalog-only hosted Web diffs", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/app/api/settings/route.ts",
        "apps/web/src/lib/hosted-onboarding/service.ts",
      ],
      prBody: "",
    }),
    { required: false },
  );
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/app/design/components-content.tsx",
        "apps/web/app/design/group-usage-funding-study.tsx",
      ],
      prBody: "",
    }),
    { required: false },
  );
});
