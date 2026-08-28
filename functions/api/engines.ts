import { engines, optionsResponse, requireApiIdentity, unauthorized } from "./_runtime";

type Context = { request: Request; env: Record<string, string> };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestGet = async ({ request, env }: Context) => (await requireApiIdentity({ request, env })) ? engines(request) : unauthorized(request);
