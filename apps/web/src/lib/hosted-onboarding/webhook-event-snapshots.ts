import {
  minimizeLinqMessageReceivedEvent,
  type LinqMessageReceivedEvent,
} from "@murphai/messaging-ingress";

export function minimizeHostedLinqMessageReceivedEvent(
  event: LinqMessageReceivedEvent,
): Record<string, unknown> {
  return minimizeLinqMessageReceivedEvent(event);
}
