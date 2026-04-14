export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { installHostedWebWarningFilters } = await import("./src/lib/process-warnings");
  installHostedWebWarningFilters();
}
