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

test("does not manufacture proof syntax by joining tokens around comments", () => {
  const changedPaths = [
    "apps/web/app/settings/page.tsx",
    "apps/web/app/design/components-content.tsx",
  ];
  const splitHeading = validateFrontendDesignProof({
    changedPaths,
    prBody: `
#<!-- hidden --># Design proof

- Design page: /design?tab=components#settings
- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
`,
  });
  assert.deepEqual(splitHeading.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);

  const splitImageMarker = validateFrontendDesignProof({
    changedPaths,
    prBody: `
## Design proof

- Design page: /design?tab=components#settings
- Desktop screenshot: !<!-- hidden -->[Desktop settings](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)
`,
  });
  assert.deepEqual(splitImageMarker.errors, [
    "The Design proof section must include a hosted desktop screenshot from the design page.",
  ]);
});

test("preserves comment line breaks between proof labels and values", () => {
  const changedPaths = [
    "apps/web/app/settings/page.tsx",
    "apps/web/app/design/components-content.tsx",
  ];
  const splitRoute = validateFrontendDesignProof({
    changedPaths,
    prBody: [
      "## Design proof",
      "",
      "- Design page:<!--",
      "hidden",
      "--> /design?tab=components#settings",
      "- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)",
      "- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)",
    ].join("\n"),
  });
  assert.deepEqual(splitRoute.errors, [
    "The Design proof section must link to `/design?tab=components` or `/design?tab=sections`.",
  ]);

  const splitScreenshot = validateFrontendDesignProof({
    changedPaths,
    prBody: [
      "## Design proof",
      "",
      "- Design page: /design?tab=components#settings",
      "- Desktop screenshot:<!--",
      "hidden",
      "--> ![Desktop settings](https://example.test/desktop.png)",
      "- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)",
    ].join("\r\n"),
  });
  assert.deepEqual(splitScreenshot.errors, [
    "The Design proof section must include a hosted desktop screenshot from the design page.",
  ]);
});

test("does not count a Design proof section inside a fenced code block", () => {
  const changedPaths = [
    "apps/web/app/settings/page.tsx",
    "apps/web/app/design/components-content.tsx",
  ];
  const proofLines = [
    "## Design proof",
    "",
    "- Design page: /design?tab=components#settings",
    "- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)",
    "- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)",
  ];

  for (const prBody of [
    ["```md", ...proofLines, "```"].join("\n"),
    ["~~~md", ...proofLines, "~~~"].join("\n"),
    ["```md", ...proofLines].join("\n"),
  ]) {
    const result = validateFrontendDesignProof({ changedPaths, prBody });
    assert.deepEqual(result.errors, [
      "Add a `## Design proof` section to the pull request body.",
    ]);
  }
});

test("does not count proof inside raw HTML containers", () => {
  const changedPaths = [
    "apps/web/app/settings/page.tsx",
    "apps/web/app/design/components-content.tsx",
  ];
  const proofLines = [
    "## Design proof",
    "",
    "- Design page: /design?tab=components#settings",
    "- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)",
    "- Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)",
  ];

  for (const tag of ["div", "pre", "script", "style", "textarea"]) {
    const prBody = [`<${tag}>`, ...proofLines, `</${tag}>`].join("\n");
    const result = validateFrontendDesignProof({ changedPaths, prBody });
    assert.deepEqual(result.errors, [
      "Add a `## Design proof` section to the pull request body.",
    ]);
  }

  const unclosedPre = validateFrontendDesignProof({
    changedPaths,
    prBody: ["<pre>", ...proofLines].join("\n"),
  });
  assert.deepEqual(unclosedPre.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);

  const nestedDiv = validateFrontendDesignProof({
    changedPaths,
    prBody: ["<div>", "<div></div>", ...proofLines, "</div>"].join("\n"),
  });
  assert.deepEqual(nestedDiv.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);

  const voidBlockTag = validateFrontendDesignProof({
    changedPaths,
    prBody: ["<hr>", ...proofLines].join("\n"),
  });
  assert.deepEqual(voidBlockTag.errors, [
    "Add a `## Design proof` section to the pull request body.",
  ]);

  for (const [start, end] of [
    ["<span>", "</span>"],
    ["<template>", "</template>"],
    ["<?proof", "?>"],
    ["<!PROOF", ">"],
    ["<![CDATA[", "]]>"],
  ]) {
    const delimitedBlock = validateFrontendDesignProof({
      changedPaths,
      prBody: [start, ...proofLines, end].join("\n"),
    });
    assert.deepEqual(delimitedBlock.errors, [
      "Add a `## Design proof` section to the pull request body.",
    ]);
  }
});

test("accepts proof after a raw HTML block and standalone HTML images", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: [
      "<div>",
      "Supporting context",
      "</div>",
      "",
      "## Design proof",
      "",
      "- Design page: /design?tab=components#settings",
      '- Desktop screenshot: <img src="https://example.test/desktop.png">',
      '- Mobile screenshot: <img src="https://example.test/mobile.png">',
    ].join("\n"),
  });

  assert.deepEqual(result.errors, []);
});

test("does not count proof fields inside indented code blocks", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/app/settings/page.tsx",
      "apps/web/app/design/components-content.tsx",
    ],
    prBody: [
      "## Design proof",
      "",
      "    - Design page: /design?tab=components#settings",
      "\t- Desktop screenshot: ![Desktop settings](https://example.test/desktop.png)",
      "    - Mobile screenshot: ![Mobile settings](https://example.test/mobile.png)",
    ].join("\n"),
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
