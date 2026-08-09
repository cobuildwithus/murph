import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { SiteFooterVitals } from "@/src/components/homepage/site-footer-vitals";
import { MESSAGE_VOLUME_ENDPOINT } from "@/src/lib/message-volume";
import { STATUS_PAGE_SUMMARY_ENDPOINT } from "@/src/lib/status-page";

import { renderClientComponent } from "./render-client-component";

function stubFetch(statusResult: () => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === MESSAGE_VOLUME_ENDPOINT) {
      return Promise.resolve(Response.json({ total: 12_345 }));
    }
    if (url === STATUS_PAGE_SUMMARY_ENDPOINT) {
      return statusResult();
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

async function renderVitals() {
  const rendered = await renderClientComponent(
    createElement(SiteFooterVitals),
    { requireButton: false },
  );
  // Let the mount-time fetch chains resolve and re-render.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await rendered.rerender(createElement(SiteFooterVitals));
  return rendered;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders counter and status fallbacks without starting client loads during first paint", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const markup = renderToStaticMarkup(createElement(SiteFooterVitals));

  expect(markup).toContain("5,000+");
  expect(markup).toContain("Status");
  expect(markup).not.toContain("Murph is online");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows Murph is online when the public summary lists nothing", async () => {
  const fetchMock = stubFetch(() =>
    Promise.resolve(
      Response.json({
        summary: { affected_components: [], ongoing_incidents: [] },
      }),
    ),
  );
  const { cleanup, container } = await renderVitals();
  expect(container.textContent).toContain("Murph is online");
  expect(container.textContent).toContain("12,300+");
  const urls = requestedUrls(fetchMock);
  expect(urls.filter((url) => url === MESSAGE_VOLUME_ENDPOINT)).toHaveLength(1);
  expect(
    urls.filter((url) => url === STATUS_PAGE_SUMMARY_ENDPOINT),
  ).toHaveLength(1);
  await cleanup();
});

it("shows Murph is having issues when an incident is publicly listed", async () => {
  stubFetch(() =>
    Promise.resolve(
      Response.json({
        summary: {
          affected_components: [],
          ongoing_incidents: [{ id: "01H0000000000000000000INC0" }],
        },
      }),
    ),
  );
  const { cleanup, container } = await renderVitals();
  expect(container.textContent).toContain("Murph is having issues");
  await cleanup();
});

it("falls back to the neutral Status link on a malformed payload", async () => {
  stubFetch(() => Promise.resolve(Response.json({ summary: {} })));
  const { cleanup, container } = await renderVitals();
  expect(container.textContent).toContain("Status");
  expect(container.textContent).not.toContain("Murph is online");
  expect(container.textContent).not.toContain("having issues");
  await cleanup();
});

it("falls back to the neutral Status link when the fetch fails", async () => {
  stubFetch(() => Promise.reject(new Error("network down")));
  const { cleanup, container } = await renderVitals();
  expect(container.textContent).toContain("Status");
  expect(container.textContent).not.toContain("Murph is online");
  expect(container.textContent).not.toContain("having issues");
  await cleanup();
});
