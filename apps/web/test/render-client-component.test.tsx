import assert from "node:assert/strict";

import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("dispatches Enter and value changes for a focused controlled input", async () => {
  const onEnter = vi.fn();
  const onChange = vi.fn();
  const onFocus = vi.fn();
  const onBlur = vi.fn();
  function Input() {
    const [value, setValue] = useState("before");
    return <input
      type="text"
      value={value}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={(event) => {
        onChange(event.currentTarget.value);
        setValue(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEnter(event.currentTarget.value);
      }}
    />;
  }
  const rendered = await renderClientComponent(<Input />, { requireButton: false });
  const input = rendered.container.querySelector("input");
  assert.ok(input);
  const detach = vi.spyOn(input, "removeEventListener");
  try {
    await act(async () => {
      input.dispatchEvent(new rendered.window.Event("focusin", { bubbles: true }));
    });
    expect(onFocus).toHaveBeenCalledOnce();

    // Use the native setter so React observes a user edit instead of a tracked
    // programmatic assignment. LinkeDOM requires the legacy property event.
    const valueSetter = Object.getOwnPropertyDescriptor(
      rendered.window.HTMLInputElement.prototype, "value",
    )?.set;
    assert.ok(valueSetter);
    await act(async () => {
      valueSetter.call(input, "after");
      const event = new rendered.window.Event("propertychange");
      Object.defineProperty(event, "propertyName", { value: "value" });
      input.dispatchEvent(event);
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("after");
    expect(input.value).toBe("after");

    await act(async () => {
      const event = new rendered.window.Event("keydown", { bubbles: true });
      Object.defineProperty(event, "key", { value: "Enter" });
      input.dispatchEvent(event);
      input.dispatchEvent(new rendered.window.Event("focusout", { bubbles: true }));
    });
    expect(onEnter).toHaveBeenCalledExactlyOnceWith("after");
    expect(onBlur).toHaveBeenCalledOnce();
    expect(detach).toHaveBeenCalledWith("propertychange", expect.any(Function));
  } finally {
    await rendered.cleanup();
  }
  expect(rendered.container.childNodes).toHaveLength(0);
});

it("moves legacy input observation to the next focused control", async () => {
  const changed = vi.fn();
  const rendered = await renderClientComponent(
    <><input type="text" onChange={changed} /><input type="text" onChange={changed} /></>,
    { requireButton: false },
  );
  const [first, second] = rendered.container.querySelectorAll("input");
  assert.ok(first && second);
  const detachFirst = vi.spyOn(first, "removeEventListener");
  const detachSecond = vi.spyOn(second, "removeEventListener");
  try {
    await act(async () => {
      first.dispatchEvent(new rendered.window.Event("focusin", { bubbles: true }));
      second.dispatchEvent(new rendered.window.Event("focusin", { bubbles: true }));
    });
    expect(detachFirst).toHaveBeenCalledWith("propertychange", expect.any(Function));
    await act(async () => {
      second.dispatchEvent(new rendered.window.Event("focusout", { bubbles: true }));
    });
    expect(detachSecond).toHaveBeenCalledWith("propertychange", expect.any(Function));
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await rendered.cleanup();
  }
});
