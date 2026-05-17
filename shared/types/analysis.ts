/**
 * Generated-backed request/response types.
 *
 * `Decision` is inlined inside `AnalyzeResponse.decision` in the
 * OpenAPI schema; we extract it as a top-level alias here so consumers
 * can keep using the same name they always did.
 */

import type { components } from "./openapi.generated";

type Schemas = components["schemas"];

export type Decision = Schemas["AnalyzeResponse"]["decision"];
export type AnalyzeRequest = Schemas["AnalyzeRequest"];
export type AnalyzeResponse = Schemas["AnalyzeResponse"];
