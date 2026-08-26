export const KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES = [
  "kernel.sh",
  "onkernel.com",
] as const;

export const KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES =
  KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES.map(
    (hostname) => `https://*.${hostname}:8443`,
  );

export const KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES =
  KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES.flatMap((hostname) => [
    `https://*.${hostname}:8443`,
    `wss://*.${hostname}:8443`,
  ]);
