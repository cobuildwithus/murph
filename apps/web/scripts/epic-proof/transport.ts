import { readClinicalResponseBytes } from "../../src/lib/clinical-records/response-bytes";
import { allowWeb, base, check, oauth, requirePatient } from "./policy";

export function boundedEpicTransport(input: { transport: typeof fetch; patient: string; budget: number; deadline: number; unavailable: () => void }): typeof fetch {
  let remaining = input.budget;
  let busy = false, halted = false;
  const unavailable = () => { halted = true; input.unavailable(); };
  return async (request, init) => {
    const url = request instanceof Request ? request.url : String(request);
    allowWeb(url, init?.method ?? (request instanceof Request ? request.method : "GET"));
    check(!halted && !busy && --remaining >= 0 && Date.now() < input.deadline);
    busy = true;
    try {
      let response;
      try { response = await input.transport(request, { ...init, redirect: "manual" }); }
      catch { unavailable(); throw new Error("Sandbox unavailable."); }
      if (response.status === 429 || response.status >= 500) unavailable();
      if (response.ok && [oauth + "token", base + "/.well-known/smart-configuration"].includes(url)) {
        const bytes = await readClinicalResponseBytes(response, 128 * 1024);
        const json = JSON.parse(new TextDecoder().decode(bytes));
        if (url === oauth + "token") {
          if (json.patient || new URLSearchParams(String(init?.body)).get("grant_type") === "authorization_code") requirePatient(input.patient, json.patient);
        } else {
          check(json.token_endpoint === oauth + "token" && json.authorization_endpoint === oauth + "authorize");
        }
        return new Response(Buffer.from(bytes), { status: response.status, headers: response.headers });
      }
      return response;
    } finally { busy = false; }
  };
}
