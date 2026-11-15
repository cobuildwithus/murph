import { RequestInputError } from "@murphai/hosted-execution/request-input";

export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) throw new RequestInputError(error.message, { cause: error });
    throw error;
  }
}
