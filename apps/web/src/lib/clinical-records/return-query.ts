// A UTF-16 code unit needs at most nine percent-encoded UTF-8 characters.
// Include the fixed SMART state, separators and optional leading question mark.
export const CLINICAL_CODE_LIMIT = 8_192;
export const CLINICAL_RETURN_QUERY_LIMIT = 9 * CLINICAL_CODE_LIMIT + 128;
export const isClinicalReturnState = (value: string) => /^crs_[A-Za-z0-9_-]{43}$/u.test(value);

export function clinicalReturnQuery(params: URLSearchParams): URLSearchParams | null {
  const state = params.get("state") ?? "";
  if (!isClinicalReturnState(state) || params.getAll("state").length !== 1) return null;
  const result = new URLSearchParams({ state });
  const field = params.has("error") ? "error" : "code";
  const value = params.get(field);
  if (!value || params.getAll(field).length !== 1 || value.length > (field === "code" ? CLINICAL_CODE_LIMIT : 128)) return null;
  result.set(field, value);
  return result;
}
