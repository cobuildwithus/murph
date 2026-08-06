export type LinqHostedRuntimeHttpMethod = "DELETE" | "GET" | "POST";

type LinqHostedRuntimeRouteDefinitionShape = {
  method: LinqHostedRuntimeHttpMethod;
  operation: string;
  pathSegments: readonly (string | null)[];
};

export const LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS = [
  {
    method: "GET",
    operation: "phone_numbers_list",
    pathSegments: ["phone_numbers"],
  },
  {
    method: "GET",
    operation: "attachment_read",
    pathSegments: ["attachments", null],
  },
  {
    method: "POST",
    operation: "imessage_capability_check",
    pathSegments: ["capability", "check_imessage"],
  },
  {
    method: "POST",
    operation: "attachment_create",
    pathSegments: ["attachments"],
  },
  {
    method: "POST",
    operation: "chat_create",
    pathSegments: ["chats"],
  },
  {
    method: "POST",
    operation: "message_send",
    pathSegments: ["chats", null, "messages"],
  },
  {
    method: "POST",
    operation: "voice_memo_send",
    pathSegments: ["chats", null, "voicememo"],
  },
  {
    method: "POST",
    operation: "reaction_create",
    pathSegments: ["messages", null, "reactions"],
  },
  {
    method: "POST",
    operation: "typing_start",
    pathSegments: ["chats", null, "typing"],
  },
  {
    method: "POST",
    operation: "read_receipt_send",
    pathSegments: ["chats", null, "read"],
  },
  {
    method: "DELETE",
    operation: "typing_stop",
    pathSegments: ["chats", null, "typing"],
  },
  {
    method: "DELETE",
    operation: "message_delete",
    pathSegments: ["messages", null],
  },
] as const satisfies readonly LinqHostedRuntimeRouteDefinitionShape[];

export type LinqHostedRuntimeRouteDefinition =
  (typeof LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS)[number];
export type LinqHostedRuntimeOperation =
  LinqHostedRuntimeRouteDefinition["operation"];

export type LinqHostedRuntimeRequest = {
  method: LinqHostedRuntimeHttpMethod;
  path: string;
};

export function buildLinqHostedRuntimeRequest(
  operation: LinqHostedRuntimeOperation,
  pathParameters: readonly string[] = [],
): LinqHostedRuntimeRequest {
  const route = readLinqHostedRuntimeRouteDefinition(operation);
  const expectedParameterCount = route.pathSegments.reduce(
    (count, segment) => count + (segment === null ? 1 : 0),
    0,
  );
  if (pathParameters.length !== expectedParameterCount) {
    throw new TypeError(
      `Linq hosted runtime route ${operation} requires ${expectedParameterCount} path parameter(s).`,
    );
  }

  let parameterIndex = 0;
  const path = `/${route.pathSegments.map((segment) => {
    if (segment !== null) {
      return segment;
    }
    const value = pathParameters[parameterIndex];
    parameterIndex += 1;
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(
        `Linq hosted runtime route ${operation} received an empty path parameter.`,
      );
    }
    return encodeURIComponent(value);
  }).join("/")}`;

  return {
    method: route.method,
    path,
  };
}

export function matchLinqHostedRuntimeRoute(
  method: string,
  pathname: string,
): LinqHostedRuntimeOperation | null {
  const pathSegments = splitLinqHostedRuntimePath(pathname);
  if (!pathSegments) {
    return null;
  }

  for (const route of LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS) {
    if (method !== route.method || pathSegments.length !== route.pathSegments.length) {
      continue;
    }
    const matches = route.pathSegments.every((segment, index) =>
      segment === null || segment === pathSegments[index]
    );
    if (matches) {
      return route.operation;
    }
  }

  return null;
}

function readLinqHostedRuntimeRouteDefinition(
  operation: LinqHostedRuntimeOperation,
): LinqHostedRuntimeRouteDefinition {
  const route = LINQ_HOSTED_RUNTIME_ROUTE_DEFINITIONS.find(
    (candidate) => candidate.operation === operation,
  );
  if (!route) {
    throw new TypeError(`Unsupported Linq hosted runtime operation: ${operation}`);
  }
  return route;
}

function splitLinqHostedRuntimePath(pathname: string): string[] | null {
  if (
    !pathname.startsWith("/")
    || pathname === "/"
    || pathname.endsWith("/")
  ) {
    return null;
  }
  const segments = pathname.slice(1).split("/");
  return segments.every((segment) => segment.length > 0) ? segments : null;
}
