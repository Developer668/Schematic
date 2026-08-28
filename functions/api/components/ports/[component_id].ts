import { componentPorts, optionsResponse } from "../../_runtime";

type Context = { request: Request; env: Record<string, string>; params: { component_id: string } };
export const onRequestOptions = ({ request }: Context) => optionsResponse(request);
export const onRequestGet = ({ request, env, params }: Context) => componentPorts(request, env, params.component_id);
