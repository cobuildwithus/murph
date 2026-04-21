import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ExpertCard } from "@/src/components/experiments/experiment-detail/expert-card";

test("omits the secondary label when the expert field is empty", () => {
  const markup = renderToStaticMarkup(
    createElement(ExpertCard, {
      field: "",
      initials: "BJ",
      name: "Bryan Johnson",
      quote:
        "Blueprint founder whose public sauna routine offers a higher-burden comparison to simpler dry-sauna experiments and highlights aggressive implementation choices.",
    }),
  );

  expect(markup).toContain("Bryan Johnson");
  expect(markup).not.toContain("Source Person");
  expect(markup).toContain(
    "Blueprint founder whose public sauna routine offers a higher-burden comparison to simpler dry-sauna experiments and highlights aggressive implementation choices.",
  );
  expect(markup).not.toContain("“");
  expect(markup).not.toContain("”");
});
