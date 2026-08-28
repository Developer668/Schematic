import { compilePreflight, optionsResponse } from "./_runtime";

type Context = { request: Request; env: Record<string, string> };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestPost = ({ request, env }: Context) => compilePreflight(request, env);
