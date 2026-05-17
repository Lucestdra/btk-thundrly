/**
 * Generated-backed product / context types.
 *
 * Source of truth: `backend/app/models/schemas.py` (Pydantic). The TS
 * shapes here are derived from `openapi.generated.ts`, which is itself
 * regenerated from `shared/openapi.json` whenever the Python schemas
 * change. Workflow:
 *
 *     # 1) dump the spec
 *     cd backend && .venv/Scripts/python.exe -m scripts.dump_openapi
 *     # 2) regenerate TS
 *     cd extension && npm run types:gen
 *
 * Anything imported through `@shared/types` keeps the same public names
 * the codebase has always used — these aliases are the contract.
 */

import type { components } from "./openapi.generated";

type Schemas = components["schemas"];

export type Currency = Schemas["Product"]["currency"];
export type Product = Schemas["Product"];
export type Review = Schemas["Review"];
export type PriceHistoryPoint = Schemas["PriceHistoryPoint"];
export type UserBudget = Schemas["UserBudget"];
export type SessionContext = Schemas["SessionContext"];
