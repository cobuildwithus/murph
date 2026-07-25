import { act, createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { AccountExitReasonStep } from "@/src/components/settings/account-exit-reason-step";
import {
  HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH,
  HOSTED_ACCOUNT_EXIT_REASONS,
} from "@/src/lib/hosted-privacy/account-data-shared";

import { renderClientComponent } from "./render-client-component";

let cleanupRender: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanupRender?.();
  cleanupRender = null;
});

function noop() {
  return undefined;
}

function baseProps() {
  return {
    note: "",
    onContinue: noop,
    onNoteChange: noop,
    onReasonChange: noop,
    onSkip: noop,
    reason: null,
  };
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button, `expected a "${label}" button`).toBeTruthy();
  return button as HTMLButtonElement;
}

test("offers every exit reason and keeps skipping available", async () => {
  const { cleanup, container } = await renderClientComponent(
    createElement(AccountExitReasonStep, baseProps()),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  for (const option of HOSTED_ACCOUNT_EXIT_REASONS) {
    expect(container.textContent).toContain(option.label);
  }

  // Nothing chosen yet: Continue has nothing to send, but leaving must stay
  // one click away.
  expect(findButton(container, "Continue").disabled).toBe(true);
  expect(findButton(container, "Skip").disabled).toBe(false);
});

test("reveals the note field only once a reason is chosen", async () => {
  const { cleanup, container, rerender } = await renderClientComponent(
    createElement(AccountExitReasonStep, baseProps()),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  expect(container.querySelector("textarea")).toBeNull();

  await rerender(createElement(AccountExitReasonStep, {
    ...baseProps(),
    reason: "too_expensive" as const,
  }));

  const textarea = container.querySelector("textarea");
  expect(textarea).toBeTruthy();
  // Attribute casing is not normalized by the test DOM, so match either form
  // rather than assume one. The authoritative cap is enforced server side.
  expect(textarea?.outerHTML).toMatch(
    new RegExp(`maxlength="${HOSTED_ACCOUNT_EXIT_NOTE_MAX_LENGTH}"`, "iu"),
  );
  expect(findButton(container, "Continue").disabled).toBe(false);
});

test("reports the chosen reason", async () => {
  const onReasonChange = vi.fn();
  const { cleanup, container } = await renderClientComponent(
    createElement(AccountExitReasonStep, {
      ...baseProps(),
      onReasonChange,
    }),
    { requireButton: false },
  );
  cleanupRender = cleanup;

  const input = container.querySelector<HTMLElement>(
    "#hosted-account-exit-reason-privacy_concerns",
  );
  expect(input).toBeTruthy();

  await act(async () => {
    input?.click();
  });

  expect(onReasonChange).toHaveBeenCalledWith("privacy_concerns");
});
