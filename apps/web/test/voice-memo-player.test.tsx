import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test, vi } from "vitest";

import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

import { renderClientComponent } from "./render-client-component";

test("VoiceMemoPlayer pauses sibling players in the same exclusive group", async () => {
  const rendered = await renderClientComponent(
    createElement("div", null,
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
