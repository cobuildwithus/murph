import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { HostedVerificationCodeStep } from "@/src/components/hosted-onboarding/hosted-verification-code-step";

import { renderClientComponent } from "./render-client-component";

function createVerificationStep(code: string) {
  return (
    <HostedVerificationCodeStep
      code={code}
      description="We texted the latest code."
      disabled={false}
      pendingAction={null}
      primaryActionLabel="Verify phone"
      primaryActionPendingLabel="Finishing..."
      onCodeChange={() => {}}
      onResendCode={() => {}}
      onSubmit={() => {}}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("hydrates the controlled production verification step without OTP diagnostics", async () => {
  const serverMarkup = renderToString(createVerificationStep("123"));
  expect(serverMarkup).toContain('data-1p-ignore="true"');
  expect(serverMarkup).toContain('data-bwignore="true"');
  expect(serverMarkup).toContain('data-form-type="other"');
  expect(serverMarkup).toContain('data-lpignore="true"');

  const onRecoverableError = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const rendered = await renderClientComponent(createVerificationStep("123"), {
    hydrateFrom: {
      markup: serverMarkup,
      onRecoverableError,
      prepareDom(container) {
        const input = container.querySelector<HTMLInputElement>(
          "input[data-input-otp]",
        );
        if (!input) {
          return;
        }
        // Linkedom preserves JSX attribute casing when parsing HTML strings;
        // browser HTML parsers lowercase attribute names before hydration.
        for (const attribute of [...input.attributes]) {
          const browserAttributeName = attribute.name.toLowerCase();
          if (browserAttributeName === attribute.name) {
            continue;
          }
          input.removeAttribute(attribute.name);
          input.setAttribute(browserAttributeName, attribute.value);
        }
        const getAttribute = input.getAttribute.bind(input);
        const hasAttribute = input.hasAttribute.bind(input);
        input.getAttribute = (name) =>
          getAttribute(name) ?? getAttribute(name.toLowerCase());
        input.hasAttribute = (name) =>
          hasAttribute(name) || hasAttribute(name.toLowerCase());
      },
    },
    innerWidth: 1_024,
    requireButton: false,
  });

  try {
    const input = rendered.container.querySelector<HTMLInputElement>(
      "input[data-input-otp]",
    );
    const label = rendered.container.querySelector("label");
    expect(input?.value).toBe("123");
    expect(input?.style.width).toBe("100%");
    expect(label?.getAttribute("for")).toBe(input?.id);
    expect(input?.getAttribute("data-1p-ignore")).toBe("true");
    expect(input?.getAttribute("data-bwignore")).toBe("true");
    expect(input?.getAttribute("data-form-type")).toBe("other");
    expect(input?.getAttribute("data-lpignore")).toBe("true");

    await rendered.rerender(createVerificationStep("1234"));

    expect(input?.value).toBe("1234");
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
});
