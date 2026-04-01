import {
  minimizeLinqMessageReceivedEvent,
  minimizeTelegramUpdate,
  type LinqMessageReceivedEvent,
  type TelegramUpdateLike,
} from "@murphai/messaging-ingress";

export function minimizeHostedLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): Record<string, unknown> {
  return minimizeLinqMessageReceivedEvent(event);
}

export function minimizeHostedTelegramUpdate(
  update: TelegramUpdateLike,
): Record<string, unknown> {
  return minimizeTelegramUpdate(update);
}
