import {
  createInboxPipeline,
  openInboxRuntime,
  rebuildRuntimeFromVault,
} from "@murphai/inboxd";

type HostedInboxPipeline = Awaited<ReturnType<typeof createInboxPipeline>>;

export async function withHostedInboxPipeline<T>(
  vaultRoot: string,
  callback: (pipeline: HostedInboxPipeline) => Promise<T>,
): Promise<T> {
  const runtime = await openInboxRuntime({
    vaultRoot,
  });
  let pipeline: HostedInboxPipeline | null = null;

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot,
    });

    return await callback(pipeline);
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}
