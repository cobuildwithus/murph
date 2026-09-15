import { parseHostedRuntimeMigrationCommand, parseLegacyRuntimeExportCursor } from "@murphai/hosted-execution/runtime-migration";
import { commandHostedRuntimeMigration } from "../../runtime-migration-client.ts";
import { json, readOptionalJsonObject } from "../../json.ts";
import { usesPostgresRuntimeOwner } from "../../runtime-cutover.ts";
import type { WorkerRouteContext } from "../../worker-routes/shared.ts";
import type { DeclarativeRoute } from "../routes.ts";

/** Temporary operator surface behind the existing control-plane OIDC boundary.
 * The Worker obtains export pages from the bound namespace; callers cannot
 * submit manufactured resource pages or use a member lookup as fleet inventory. */
export const runtimeMigrationRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [{
  authorization: "vercel-oidc", authorizeBeforeMethod: true,
  match: pathname => pathname === "/internal/runtime-migration" ? {} : null,
  methods: ["POST"], name: "runtime-migration", wrongMethodResponse: "method-not-allowed",
  async handle(context) {
    const command = parseHostedRuntimeMigrationCommand(await readOptionalJsonObject(context.request, { limitBytes: 16 * 1024 }));
    if (command.operation === "status") return json(await commandHostedRuntimeMigration({ source: context.env, command }));
    const metadata = context.env.CF_VERSION_METADATA;
    if (!metadata || typeof metadata !== "object" || !("id" in metadata) || metadata.id !== command.workerVersion) {
      throw new Error("Migration request reached a different serving Worker version.");
    }
    if (!usesPostgresRuntimeOwner(context.env)) throw new Error("Migration requires the Postgres-capable fleet deployment.");
    // Import's page is produced below, never accepted as operator input.
    if (command.operation !== "read_object") {
      if (command.operation === "import") throw new Error("Resource import requires an exact-object read.");
      return json(await commandHostedRuntimeMigration({ source: context.env, command }));
    }
    const current = await commandHostedRuntimeMigration({ source: context.env, command });
    const object = current.object;
    if (!object || typeof object !== "object" || !("completedAt" in object) || !("nextCursor" in object)) throw new Error("Migration receipt is invalid.");
    if (object.completedAt) return json(current);
    const namespace = context.env.USER_RUNNER;
    if (!namespace.get || !namespace.idFromString) throw new Error("Migration requires exact Durable Object addressing.");
    const stub = namespace.get(namespace.idFromString(command.objectId));
    if (!stub.freezeForPostgresMigration || !stub.exportPostgresMigrationPage) throw new Error("Legacy object does not support the migration protocol.");
    if (!(await stub.freezeForPostgresMigration()).frozen) return json({ draining: true });
    const page = await stub.exportPostgresMigrationPage(parseLegacyRuntimeExportCursor(object.nextCursor));
    return json(await commandHostedRuntimeMigration({ source: context.env, command: { ...command, operation: "import", page } }));
  },
}];
