import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { ShareEnvironmentButton } from "../app/(dashboard)/environment/environment-components";
import { renderClientComponent } from "./render-client-component";

test("downloads the personal score image when file sharing is unavailable", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(new Blob(["png"], { type: "image/png" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const rendered = await renderClientComponent(
    createElement(ShareEnvironmentButton, {
      coverage: 88,
      grade: {
        eligible: 8,
        graded: 8,
        letter: "A",
        met: 7,
        pct: 91,
        redFlags: 0,
      },
      known: 8,
      total: 16,
    }),
  );

  try {
    const shareMock = vi.fn();
    Object.defineProperty(rendered.window.navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(rendered.window.navigator, "share", {
      configurable: true,
      value: shareMock,
    });
    const createObjectUrl = vi.fn(() => "blob:environment-score");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const anchorClick = vi
      .spyOn(rendered.window.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await act(async () => {
      rendered.button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(shareMock.mock.calls.length, 0);
    assert.equal(anchorClick.mock.calls.length, 1);
    assert.equal(createObjectUrl.mock.calls.length, 1);
    assert.equal(revokeObjectUrl.mock.calls.length, 1);
    assert.match(rendered.container.textContent ?? "", /Image downloaded/);
  } finally {
    await rendered.cleanup();
  }
});
