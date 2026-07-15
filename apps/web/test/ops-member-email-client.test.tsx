import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("lucide-react", () => ({
  SearchIcon: () => createElement("svg"),
  SendIcon: () => createElement("svg"),
}));

vi.mock("@/src/components/ui/alert", () => ({
  Alert: ({ variant, ...props }: ComponentProps<"div"> & { variant?: string }) => {
    void variant;
    return createElement("div", { role: "alert", ...props });
  },
  AlertDescription: (props: ComponentProps<"div">) => createElement("div", props),
  AlertTitle: (props: ComponentProps<"div">) => createElement("div", props),
}));

vi.mock("@/src/components/ui/badge", () => ({
  Badge: ({ variant, ...props }: ComponentProps<"span"> & { variant?: string }) => {
    void variant;
    return createElement("span", props);
  },
}));

vi.mock("@/src/components/ui/button", () => ({
  Button: ({ size, variant, ...props }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => {
    void size;
    void variant;
    return createElement("button", props);
  },
}));

vi.mock("@/src/components/ui/label", () => ({
  Label: (props: ComponentProps<"label">) => createElement("label", props),
}));

vi.mock("@/src/components/ui/input", () => ({
  Input: ({ onChange, ...props }: ComponentProps<"input">) =>
    createElement("input", { ...props, onInput: onChange }),
}));

vi.mock("@/src/components/ui/textarea", () => ({
  Textarea: ({ onChange, ...props }: ComponentProps<"textarea">) =>
    createElement("textarea", { ...props, onInput: onChange }),
}));

import {
  MemberEmailClient,
  parseHostedOpsMemberIds,
} from "../app/(dashboard)/ops/email/member-email-client";
import type {
  HostedOpsMemberEmailResult,
} from "../src/lib/hosted-ops/member-email";
import { renderClientComponent } from "./render-client-component";

const fetchMock = vi.fn<typeof fetch>();
const MEMBER_ONE = "hbm_member_1";
const MEMBER_TWO = "hbm_member_2";
const PREVIEW_PROOF = {
  previewedAt: "2026-07-15T16:00:00.000Z",
  token: `ops-member-email-preview-v1.v1.${"a".repeat(43)}`,
};
let cleanupRender: (() => Promise<void>) | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (cleanupRender) {
    await cleanupRender();
    cleanupRender = null;
  }
  vi.unstubAllGlobals();
});

describe("MemberEmailClient", () => {
  test("parses newline, comma, and whitespace-separated IDs without duplicates", () => {
    expect(parseHostedOpsMemberIds(
      ` ${MEMBER_ONE}\n${MEMBER_TWO}, ${MEMBER_ONE} `,
    )).toEqual([MEMBER_ONE, MEMBER_TWO]);
  });

  test("previews recipient eligibility and sends the exact signed draft", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makePreviewResult()))
      .mockResolvedValueOnce(jsonResponse(makeSentResult()));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;

    await fillDraft(rendered, {
      memberIds: `${MEMBER_ONE}\n${MEMBER_TWO}, ${MEMBER_ONE}`,
      subject: " Trial update ",
      text: "\nHey,\n\nYour trial is ready again.\n",
    });
    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));

    expect(readRequestBody(0)).toEqual({
      memberIds: [MEMBER_ONE, MEMBER_TWO],
      mode: "preview",
      subject: " Trial update ",
      text: "\nHey,\n\nYour trial is ready again.\n",
    });
    expect(rendered.container.textContent).toContain("1 of 2 members are ready");
    expect(rendered.container.textContent).toContain(MEMBER_ONE);
    expect(rendered.container.textContent).toContain("No email");
    expect(rendered.container.textContent).not.toContain("member@example.com");
    expect(rendered.container.textContent).toContain("Send to 1 member");

    await clickButton(rendered.window, getButton(rendered.container, "Send to 1 member"));

    expect(readRequestBody(1)).toEqual({
      memberIds: [MEMBER_ONE, MEMBER_TWO],
      mode: "send",
      previewProof: PREVIEW_PROOF,
      subject: " Trial update ",
      text: "\nHey,\n\nYour trial is ready again.\n",
    });
    expect(rendered.container.textContent).toContain("Batch complete");
    expect(rendered.container.textContent).toContain("1 member email was sent");
    expect(rendered.container.textContent).not.toContain("Send to 1 member");
  });

  test("keeps the same Preview for a retry after an ambiguous Send", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makePreviewResult()))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(jsonResponse(makeSentResult()));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);
    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));
    await clickButton(rendered.window, getButton(rendered.container, "Send to 1 member"));

    expect(rendered.container.textContent).toContain(
      "Retry Send with the same Preview",
    );
    expect(rendered.container.textContent).toContain("Send not confirmed");
    expect(rendered.container.textContent).toContain("Send to 1 member");

    await clickButton(rendered.window, getButton(rendered.container, "Send to 1 member"));

    expect(readRequestBodyText(2)).toBe(readRequestBodyText(1));
    expect(rendered.container.textContent).toContain("Batch complete");
  });

  test("clears a stale Preview and requires another Preview", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(makePreviewResult()))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "HOSTED_OPS_MEMBER_EMAIL_PREVIEW_STALE",
          message: "The member or draft changed since Preview. Preview this email again.",
        },
      }, 409));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);
    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));
    await clickButton(rendered.window, getButton(rendered.container, "Send to 1 member"));

    expect(rendered.container.textContent).toContain("changed since Preview");
    expect(rendered.container.textContent).toContain("Nothing ready yet");
    expect(rendered.container.textContent).not.toContain("Send to 1 member");
  });

  test("shows complete member IDs in the recipient review", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makePreviewResult()));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);

    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));

    const memberId = Array.from(rendered.container.querySelectorAll("span")).find(
      (candidate) => candidate.textContent === MEMBER_ONE,
    );
    expect(memberId?.className).toContain("break-all");
    expect(memberId?.className).not.toContain("truncate");
  });

  test("changing any draft field clears an existing Preview", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(makePreviewResult()));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);
    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));
    expect(rendered.container.textContent).toContain("Send to 1 member");

    await changeValue(
      rendered.window,
      requireElement<HTMLInputElement>(rendered.container, "#member-email-subject"),
      "Changed subject",
    );

    expect(rendered.container.textContent).toContain("Nothing ready yet");
    expect(rendered.container.textContent).not.toContain("Send to 1 member");
  });

  test("blocks Preview when more than 100 unique member IDs are entered", async () => {
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered, {
      memberIds: Array.from({ length: 101 }, (_, index) => `hbm_${index}`).join("\n"),
    });

    expect(rendered.container.textContent).toContain("no more than 100");
    expect(getButton(rendered.container, "Preview recipients").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a malformed successful Preview response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      message: "Preview ready.",
      outcome: "preview",
      previewProof: PREVIEW_PROOF,
      recipients: [],
      summary: {},
    }));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);

    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));

    expect(rendered.container.textContent).toContain(
      "Member email returned an invalid response.",
    );
    expect(rendered.container.textContent).toContain("Nothing ready yet");
    expect(rendered.container.textContent).not.toContain("Send to 1 member");
  });

  test("associates required field help and errors with each draft control", async () => {
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;

    const memberIds = requireElement<HTMLTextAreaElement>(
      rendered.container,
      "#member-email-member-ids",
    );
    const subject = requireElement<HTMLInputElement>(
      rendered.container,
      "#member-email-subject",
    );
    const text = requireElement<HTMLTextAreaElement>(
      rendered.container,
      "#member-email-text",
    );

    expect(memberIds.hasAttribute("required")).toBe(true);
    expect(memberIds.getAttribute("aria-describedby")).toBe(
      "member-email-member-ids-description",
    );
    expect(subject.hasAttribute("required")).toBe(true);
    expect(subject.getAttribute("aria-describedby")).toBe(
      "member-email-subject-count",
    );
    expect(text.hasAttribute("required")).toBe(true);
    expect(text.getAttribute("aria-describedby")).toBe(
      "member-email-text-count member-email-text-description",
    );

    await changeValue(rendered.window, subject, "s".repeat(201));
    expect(subject.getAttribute("aria-errormessage")).toBe(
      "member-email-subject-error",
    );
    expect(getButton(rendered.container, "Preview recipients").disabled).toBe(true);
  });

  test("labels Preview failures without implying that Send was attempted", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("connection lost"));
    const rendered = await renderClientComponent(createElement(MemberEmailClient));
    cleanupRender = rendered.cleanup;
    await fillDraft(rendered);

    await clickButton(rendered.window, getButton(rendered.container, "Preview recipients"));

    expect(rendered.container.textContent).toContain("Preview failed");
    expect(rendered.container.textContent).not.toContain("Send not confirmed");
  });
});

function makePreviewResult(): HostedOpsMemberEmailResult {
  return {
    message: "1 of 2 members are ready to receive this email.",
    outcome: "preview",
    previewProof: PREVIEW_PROOF,
    recipients: [
      { memberId: MEMBER_ONE, status: "ready" },
      { memberId: MEMBER_TWO, status: "no_email" },
    ],
    summary: {
      readyCount: 1,
      requestedCount: 2,
      sentCount: 0,
      skippedCount: 1,
    },
  };
}

function makeSentResult(): HostedOpsMemberEmailResult {
  return {
    message: "1 member email was sent.",
    outcome: "sent",
    previewProof: null,
    recipients: [
      { memberId: MEMBER_ONE, status: "sent" },
      { memberId: MEMBER_TWO, status: "no_email" },
    ],
    summary: {
      readyCount: 0,
      requestedCount: 2,
      sentCount: 1,
      skippedCount: 1,
    },
  };
}

async function fillDraft(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  overrides: Partial<{
    memberIds: string;
    subject: string;
    text: string;
  }> = {},
): Promise<void> {
  await changeValue(
    rendered.window,
    requireElement<HTMLTextAreaElement>(rendered.container, "#member-email-member-ids"),
    overrides.memberIds ?? `${MEMBER_ONE}\n${MEMBER_TWO}`,
  );
  await changeValue(
    rendered.window,
    requireElement<HTMLInputElement>(rendered.container, "#member-email-subject"),
    overrides.subject ?? "Trial update",
  );
  await changeValue(
    rendered.window,
    requireElement<HTMLTextAreaElement>(rendered.container, "#member-email-text"),
    overrides.text ?? "Hey,\n\nYour trial is ready again.",
  );
}

function requireElement<T extends Element>(
  container: HTMLElement,
  selector: string,
): T {
  const element = container.querySelector(selector);
  if (!element) {
    throw new Error(`Expected element ${selector}.`);
  }
  return element as T;
}

async function changeValue(
  window: Window & typeof globalThis,
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function clickButton(
  window: Window & typeof globalThis,
  button: HTMLButtonElement,
): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function getButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Expected button containing ${text}.`);
  }
  return button;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function readRequestBody(index: number): unknown {
  return JSON.parse(readRequestBodyText(index)) as unknown;
}

function readRequestBodyText(index: number): string {
  const init = fetchMock.mock.calls[index]?.[1];
  if (!init || typeof init.body !== "string") {
    throw new Error("Expected a JSON request body.");
  }
  return init.body;
}
