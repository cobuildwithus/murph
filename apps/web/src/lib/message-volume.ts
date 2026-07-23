export const HOSTED_MESSAGE_VOLUME_FLOOR = 5_000;
export const MESSAGE_VOLUME_ENDPOINT = "/api/message-volume";

export function formatMessageVolume(total: number): string {
  const rounded = Math.floor(total / 100) * 100;
  return `${rounded.toLocaleString("en-US")}+`;
}
