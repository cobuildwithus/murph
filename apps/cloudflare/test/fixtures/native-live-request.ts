/** Public wire shape emitted by the pinned native CLI, using synthetic media. */
export function nativeLiveRequest() {
  return {
    session: {
      model: "gpt-live-1", instructions: "Delegate requests to the backing assistant.",
      audio: { output: { voice: "marin" } }, delegation: { type: "client" },
      client: { data_channel: {
        allowed_client_events: ["session.input_audio.mute", "session.input_audio.unmute", "session.close"],
        allowed_server_events: [{ type: "session.started" }, { type: "session.closed" }, { type: "session.usage.updated" }],
      } },
    },
    transport: { type: "webrtc", sdp: "v=0\r\nsynthetic-offer" },
  };
}
