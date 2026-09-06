type Operation = "bootstrap" | "connect" | "save" | "close";
type NativeReply = { status: number; body: string; contentType: string };

declare global {
  interface Window {
    webkit?: { messageHandlers?: {
      environment?: { postMessage(message: { operation: Operation; body: string }): Promise<NativeReply> };
    } };
  }
}

export async function requestNativeEnvironment(operation: Operation, body = ""): Promise<Response> {
  const bridge = window.webkit?.messageHandlers?.environment;
  if (!bridge) throw new Error("Open this interview in the Murph app.");
  const response = await bridge.postMessage({ operation, body });
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599
    || typeof response.body !== "string" || typeof response.contentType !== "string") {
    throw new Error("The interview response was unavailable.");
  }
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.contentType },
  });
}
