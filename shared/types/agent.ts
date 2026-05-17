/**
 * Generated-backed agent types + the one hand-maintained alias.
 *
 * `AgentName` is the *key* set of `AgentResultMap` (a TypeScript-side
 * concept), not a value type in the Python schema — so we derive it
 * from the generated map keys rather than carrying a parallel literal.
 */

import type { components } from "./openapi.generated";

type Schemas = components["schemas"];

export type Severity = Schemas["AgentFinding"]["severity"];
export type AgentFinding = Schemas["AgentFinding"];
export type AgentResult = Schemas["AgentResult"];
export type AgentResultMap = Schemas["AgentResultMap"];
export type AgentName = keyof AgentResultMap;
