export const ASSISTANT_GENERATED_DELIVERY_DIRECTORY =
  ".runtime/operations/assistant/generated-deliveries";

const ASSISTANT_GENERATED_DELIVERY_PREFIX =
  `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/`;

export function isAssistantGeneratedDeliveryRef(value: string): boolean {
  if (!value.startsWith(ASSISTANT_GENERATED_DELIVERY_PREFIX)) {
    return false;
  }

  const filename = value.slice(ASSISTANT_GENERATED_DELIVERY_PREFIX.length);
  return (
    filename.length > 0
    && !filename.includes("/")
    && !filename.includes("\\")
    && !/[\u0000-\u001F\u007F]/u.test(filename)
    && !filename.startsWith(".")
    && filename !== "tmp"
    && filename !== "secrets"
    && filename !== "quarantine"
    && !filename.endsWith(".lock")
    && !filename.endsWith(".pid")
    && !filename.endsWith(".sock")
    && !filename.endsWith(".socket")
    && !filename.endsWith(".tmp")
  );
}

export function isNormalizedAssistantVaultFileRef(value: string): boolean {
  if (
    value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || value.includes("\\")
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return false;
  }

  const segments = value.split("/");
  const isOrdinaryVaultRef = segments.every((segment) => (
    segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.startsWith(".")
  ));
  return isOrdinaryVaultRef || isAssistantGeneratedDeliveryRef(value);
}
