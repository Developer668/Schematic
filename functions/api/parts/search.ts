import { jsonResponse, optionsResponse, requireApiIdentity } from "../_runtime";

type Context = { request: Request; env: Record<string, string> };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestGet = async ({ request, env }: Context) => {
  if (!(await requireApiIdentity({ request, env }))) return jsonResponse(request, { error: "Sign in to use this Schematic workspace" }, 401);
  const url = new URL(request.url);
  return jsonResponse(request, {
    code: "PARTS_PROVIDER_NOT_CONFIGURED",
    message: "No live parts provider is configured for this deployment.",
    query: url.searchParams.get("query") ?? "",
    quantity: Number(url.searchParams.get("quantity") ?? 1),
    liveOffers: false,
    hint: "Supply normalized listings through the shopping WebMCP tool or connect a parts provider before treating prices as live.",
  }, 503);
};
