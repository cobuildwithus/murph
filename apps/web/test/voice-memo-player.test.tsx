import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

import { renderClientComponent } from "./render-client-component";

test("VoiceMemoPlayer adapts waveform density to its rendered width", async () => {
  let notifyResize: ((width: number) => void) | undefined;
  let observedElement: Element | undefined;
  class TestResizeObserver {
    constructor(
      callback: (entries: Array<{ contentRect: { width: number } }>) => void,
    ) {
      notifyResize = (width) => callback([{ contentRect: { width } }]);
    }

    disconnect() {}
    observe(element: Element) {
      observedElement = element;
    }
  }
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      bars: 12,
      src: "/audio/responsive.mp3",
    }),
    { requireButton: false },
  );

  try {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    await rendered.rerender(
      createElement(VoiceMemoPlayer, {
        bars: 12,
        key: "responsive-waveform",
        src: "/audio/responsive.mp3",
      }),
    );
    const waveform = rendered.container.querySelector(
      "button[data-voice-memo-waveform]",
    );
    assert.ok(waveform);
    assert.equal(observedElement, waveform);
    assert.equal(waveform.querySelectorAll("span").length, 12);
    assert.ok(notifyResize);

    await act(async () => notifyResize?.(360));
    assert.equal(waveform.querySelectorAll("span").length, 60);

    await act(async () => notifyResize?.(90));
    assert.equal(waveform.querySelectorAll("span").length, 24);
  } finally {
    await rendered.cleanup();
    vi.unstubAllGlobals();
  }
});

test("VoiceMemoPlayer gives both controls a voice-specific accessible name", async () => {
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      accessibleLabel: "Husky voice preview",
      src: "/audio/husky.mp3",
    }),
    { requireButton: false },
  );

  try {
    const labels = Array.from(rendered.container.querySelectorAll("button"))
      .map((button) => button.getAttribute("aria-label"));
    assert.deepEqual(labels, [
      "Play Husky voice preview",
      "Play Husky voice preview from waveform",
    ]);
  } finally {
    await rendered.cleanup();
  }
});

test("VoiceMemoPlayer can omit time metadata without removing playback controls", async () => {
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      showDuration: false,
      src: "/audio/compact.mp3",
    }),
    { requireButton: false },
  );

  try {
    assert.equal(rendered.container.querySelectorAll("button").length, 2);
    assert.doesNotMatch(rendered.container.textContent ?? "", /0:00/u);
  } finally {
    await rendered.cleanup();
  }
});

test("VoiceMemoPlayer pauses sibling players in the same exclusive group", async () => {
  const rendered = await renderClientComponent(
    createElement(
      "div",
      null,
      createElement(VoiceMemoPlayer, {
        exclusiveGroupId: "voice-roster",
        src: "/audio/first.mp3",
      }),
      createElement(VoiceMemoPlayer, {
        exclusiveGroupId: "voice-roster",
        src: "/audio/second.mp3",
      }),
    ),
    {
      requireButton: false,
    },
  );

  try {
    const audios = rendered.container.querySelectorAll("audio");
    assert.equal(audios.length, 2);
    const pauseFirst = vi.fn();
    Object.defineProperty(audios[0]!, "pause", {
      configurable: true,
      value: pauseFirst,
    });

    await act(async () => {
      audios[1]!.dispatchEvent(new rendered.window.Event("play"));
    });

    assert.equal(pauseFirst.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("VoiceMemoPlayer starts playback when the waveform is clicked", async () => {
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      src: "/audio/grandpa.mp3",
    }),
    {
      requireButton: false,
    },
  );

  try {
    const audio = rendered.container.querySelector("audio");
    assert.ok(audio);
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperty(audio, "play", {
      configurable: true,
      value: play,
    });

    const waveform = rendered.container.querySelector(
      "button[data-voice-memo-waveform]",
    );
    assert.ok(waveform instanceof rendered.window.HTMLButtonElement);

    await act(async () => {
      waveform.click();
    });

    assert.equal(play.mock.calls.length, 1);
  } finally {
    await rendered.cleanup();
  }
});

test("VoiceMemoPlayer disables playback and shows the unavailable label after an audio error", async () => {
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      showDuration: false,
      src: "/audio/missing.mp3",
      unavailableLabel: "Pending",
    }),
    {
      requireButton: false,
    },
  );

  try {
    const audio = rendered.container.querySelector("audio");
    assert.ok(audio);

    await act(async () => {
      audio.dispatchEvent(new rendered.window.Event("error"));
    });

    const button = rendered.container.querySelector("button");
    assert.ok(button instanceof rendered.window.HTMLButtonElement);
    assert.equal(button.disabled, true);
    assert.match(rendered.container.textContent ?? "", /Pending/u);
  } finally {
    await rendered.cleanup();
  }
});

test("VoiceMemoPlayer falls back once before marking a preview unavailable", async () => {
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      fallbackSrc: "/audio/murph-voices/warm.mp3",
      src: "/audio/murph-personas/classic/warm.mp3",
      unavailableLabel: "Preview unavailable",
    }),
    { requireButton: false },
  );

  try {
    const audio = rendered.container.querySelector("audio");
    assert.ok(audio);
    assert.equal(
      audio.getAttribute("src"),
      "/audio/murph-personas/classic/warm.mp3",
    );

    await act(async () => {
      audio.dispatchEvent(new rendered.window.Event("error"));
    });
    assert.equal(audio.getAttribute("src"), "/audio/murph-voices/warm.mp3");
    assert.doesNotMatch(
      rendered.container.textContent ?? "",
      /Preview unavailable/u,
    );

    await act(async () => {
      audio.dispatchEvent(new rendered.window.Event("error"));
    });
    assert.match(rendered.container.textContent ?? "", /Preview unavailable/u);
    assert.equal(
      rendered.container.querySelector<HTMLButtonElement>("button")?.disabled,
      true,
    );
  } finally {
    await rendered.cleanup();
  }
});
