export const KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES = [
  "kernel.sh",
  "onkernel.com",
] as const;

// URL.port represents the default HTTPS port (443) as an empty string.
export const KERNEL_COMPUTER_LIVE_VIEW_PORTS: readonly string[] = ["", "8443"];

const liveViewHosts = KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES.flatMap((hostname) =>
  KERNEL_COMPUTER_LIVE_VIEW_PORTS.map((port) => port ? `*.${hostname}:${port}` : `*.${hostname}`),
);

export const KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES =
  liveViewHosts.map((host) => `https://${host}`);

export const KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES =
  liveViewHosts.flatMap((host) => [`https://${host}`, `wss://${host}`]);
