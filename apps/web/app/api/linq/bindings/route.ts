import { createHostedLinqControlPlane } from "../../../../src/lib/linq/control-plane";
import { jsonOk, readOptionalJsonObject } from "../../../../src/lib/http";
import { jsonError } from "../../../../src/lib/linq/http";

export async function GET(request: Request) {
  try {
    const controlPlane = createHostedLinqControlPlane(request);
    return jsonOk(await controlPlane.listBindings());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controlPlane = createHostedLinqControlPlane(request);
    const body = await readOptionalJsonObject(request);
    return jsonOk(await controlPlane.upsertBinding(body));
  } catch (error) {
    return jsonError(error);
  }
}
