import { act, createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderClientComponent } from "./render-client-component";
import type { HostedPhoneEntryStep } from "@/src/components/hosted-onboarding/hosted-phone-auth-step-views";
import type { HostedVerificationCodeStep } from "@/src/components/hosted-onboarding/hosted-verification-code-step";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), verify: vi.fn(), active: vi.fn(),
  entry: null as ComponentProps<typeof HostedPhoneEntryStep> | null,
  code: null as ComponentProps<typeof HostedVerificationCodeStep> | null,
}));
vi.mock("@/src/components/hosted-onboarding/phone-country-code-client-provider", () => ({ usePhoneCountryCode: () => "US" }));
vi.mock("@/src/components/hosted-onboarding/hosted-phone-auth-step-views", () => ({ HostedPhoneEntryStep: (props: ComponentProps<typeof HostedPhoneEntryStep>) => {
  mocks.entry = props; return createElement("span", null, "Phone entry");
} }));
vi.mock("@/src/components/hosted-onboarding/hosted-verification-code-step", () => ({ HostedVerificationCodeStep: (props: ComponentProps<typeof HostedVerificationCodeStep>) => {
  mocks.code = props; return createElement("span", null, "Code entry");
} }));
import { HostedContactCodeForm } from "@/src/components/hosted-onboarding/hosted-contact-code-form";
let rendered: Awaited<ReturnType<typeof renderClientComponent>> | null = null;
beforeEach(() => { vi.resetAllMocks(); mocks.entry = null; mocks.code = null; mocks.send.mockResolvedValue(undefined); mocks.verify.mockResolvedValue(undefined); });
afterEach(async () => { await rendered?.cleanup(); rendered = null; });
async function render(props: Partial<ComponentProps<typeof HostedContactCodeForm>> = {}) {
  rendered = await renderClientComponent(createElement(HostedContactCodeForm, {
    method: "email", initialValue: "  Synthetic@EXAMPLE.com  ", onSend: mocks.send, onVerify: mocks.verify,
    onActiveChange: mocks.active, ...props,
  }), { requireButton: false });
  return rendered;
}
async function sendEmail() {
  await act(async () => { rendered!.container.querySelector("form")!.dispatchEvent(new rendered!.window.Event("submit", { bubbles: true, cancelable: true })); });
}

test("email normalization and same-event code completion keep the proof target fixed", async () => {
  await render(); await sendEmail();
  expect(mocks.send).toHaveBeenCalledWith("synthetic@example.com", expect.any(AbortSignal));
  await act(async () => { mocks.code!.onCodeChange("12 34x56"); mocks.code!.onSubmit(); });
  expect(mocks.verify).toHaveBeenCalledWith("synthetic@example.com", "123456", expect.any(AbortSignal));
  await act(async () => { mocks.code!.onResendCode(); });
  expect(mocks.send.mock.calls.map(([value]) => value)).toEqual(["synthetic@example.com", "synthetic@example.com"]);
  expect(mocks.code!.code).toBe("");
});

test("international paste uses the pasted country before React renders its selection", async () => {
  await render({ method: "phone", initialValue: "", autoSendPastedPhoneNumber: true });
  await act(async () => { mocks.entry!.onPhoneNumberChange("7700900123", { autoSendCandidate: true, countryCode: "GB" }); });
  expect(mocks.send).toHaveBeenCalledWith("+447700900123", expect.any(AbortSignal));
});

test("credential changes retain explicit confirmation after a complete code", async () => {
  await render({ autoSubmit: false, verifyLabel: "Approve and save" }); await sendEmail();
  expect(mocks.code).toMatchObject({ autoSubmit: false, primaryActionLabel: "Approve and save" });
  await act(async () => { mocks.code!.onCodeChange("123456"); });
  expect(mocks.verify).not.toHaveBeenCalled();
  await act(async () => { mocks.code!.onSubmit(); });
  expect(mocks.verify).toHaveBeenCalledOnce();
});

test("duplicate sends coalesce and unmount aborts the request without advancing a late result", async () => {
  let finish!: () => void;
  mocks.send.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render(); await sendEmail(); await sendEmail();
  expect(mocks.send).toHaveBeenCalledOnce();
  const signal: AbortSignal = mocks.send.mock.calls[0][1];
  await rendered!.cleanup(); rendered = null;
  expect(signal.aborted).toBe(true);
  await act(async () => { finish(); });
  expect(mocks.code).toBeNull();
  expect(mocks.verify).not.toHaveBeenCalled();
});

test("delivery failure keeps entry available for a deliberate retry", async () => {
  mocks.send.mockRejectedValueOnce(new Error("Delivery unavailable"));
  await render(); await sendEmail();
  expect(rendered!.container.textContent).toContain("Delivery unavailable");
  expect(mocks.active).toHaveBeenLastCalledWith(false);
  expect(mocks.code).toBeNull();
  await sendEmail();
  expect(mocks.code).not.toBeNull();
});


test("compact invite verification retains its size and method-specific actions", async () => {
  await render({ size: "compact" }); await sendEmail();
  expect(mocks.code).toMatchObject({ size: "compact", primaryActionLabel: "Verify email", primaryActionPendingLabel: "Verifying..." });
});
