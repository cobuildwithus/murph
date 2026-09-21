# Voice components

Import from `@/src/components/live-voice`. All controls are client components;
they can be embedded from a server page. No microphone permission or provider
request happens until the person starts a conversation.

## Drop-in conversation

```tsx
import { LiveVoiceButton } from "@/src/components/live-voice";

<LiveVoiceButton
  endpoint="/api/voice/session"
  defaultVoice="willow"
  size={112}
  palette="sage"
  showVoicePicker
/>
```

`endpoint` is required. `defaultVoice` initializes the selection (Willow by
default). `size` is the circle diameter in pixels (144 by default), and `palette`
is `iris`, `ember`, or `sage`. `className` customizes the control layout.
Omit `showVoicePicker` for the compact control. Voice selection locks during a
call; end it before choosing a different voice.

The circle starts, pauses, and resumes. The separate end action closes the call.
User speech makes the orb smaller; assistant speech gently increases its size.
Both move the clouds. Reduced-motion preferences disable cloud motion and size
pulsing. WebGL failure falls back to a static image.

## Custom layout

`useLiveVoice` owns one call and releases local audio resources on unmount or
page exit. `snapshot` contains `state`, optional `error`, and normalized
`inputLevel` / `outputLevel`. `toggle` starts or toggles pause; `end` ends or
cancels; `canChangeVoice` indicates whether a new voice can be selected.
Changes to hook options apply to the next call.

```tsx
"use client";

import { LiveVoiceControl, useLiveVoice } from "@/src/components/live-voice";

export function SidebarVoice() {
  const { snapshot, toggle, end } = useLiveVoice({
    endpoint: "/api/voice/session",
    voice: "willow",
  });
  return (
    <aside aria-label="Voice conversation">
      <LiveVoiceControl {...snapshot} onToggle={toggle} onEnd={end} size={96} />
    </aside>
  );
}
```

`LiveVoiceControl` and `LiveVoicePicker` are presentational: they do not start
sessions themselves. The picker accepts `voice`, `onChange`, and `disabled`.
Use the exported `LIVE_VOICES`, `DEFAULT_LIVE_VOICE`, and prop/state types when
composing controls. Each instance has independent input names and status IDs.

## Orb without a call

```tsx
import { VoiceOrb } from "@/src/components/live-voice";

<VoiceOrb size={80} palette="ember" energy={0.4} speed={0.7} />
```

The orb includes its own positioning container, shader, and fallback image.
It is decorative and hidden from assistive technology; put it in a labeled
button when interactive. `energy` ranges from 0 to 1, `speed` controls drift,
`detail` ranges from 0 to 1, and `paused` freezes motion. `size` accepts a pixel
number or CSS width, including `100%` within a sized parent. `className`, an
optional pointer ref, and `onGraphicsAvailable` support the design playground.

## Server integration

The browser posts same-origin JSON `{ sdp: string, voice: LiveVoice }` and expects
`{ sdp: string }`. Failed responses may return `{ error: string }` with safe,
user-facing text. The endpoint must create a compatible GPT-Live WebRTC session
and return only its SDP answer. Keep API keys on the server.

The bundled `/api/live-voice/session` endpoint is a **localhost development
example**, used by `/voice`. It rejects production requests. Before enabling
public calls, supply a route with the site's authentication, admission, usage
limits, and server-owned assistant instructions. These components do not provide
those policies or access to Murph records.

Pause mutes both microphone transmission and local playback while preserving
the session; provider duration billing continues until the call is ended.
No audio or transcript is persisted by the components. Preview component states
at `/screenshots/voice#live-voice-components` and cloud controls at
`/design?tab=voice-orb`.
