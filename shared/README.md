# /shared

Ortak TypeScript tipleri ve demo payload'ları. Hem `landing/` hem `extension/` buraya `@shared/*` path alias'ı ile erişir.

## Tek doğru kaynak: Pydantic

`backend/app/models/schemas.py` kontratın **tek** sahibi. TypeScript tipleri buradan üretilir; elle senkron tutulmaz.

```
backend Pydantic schemas
    ↓  dump_openapi.py
shared/openapi.json           ← commit edilir
    ↓  openapi-typescript
shared/types/openapi.generated.ts  ← commit edilir
    ↓  type re-export
shared/types/{product,agent,analysis}.ts  ← public surface
    ↓  @shared/types
extension + landing
```

## Şemaya dokunduktan sonra

```bash
# 1) Pydantic'i değiştir (backend/app/models/schemas.py)
# 2) OpenAPI spec'i tazele:
cd backend
.venv/Scripts/python.exe -m scripts.dump_openapi
# 3) TS tiplerini yeniden üret:
cd ../extension
npm run types:gen
# 4) Test:
cd .. && (cd backend && .venv/Scripts/python.exe -m pytest) \
  && (cd extension && npm test && npm run build) \
  && (cd landing && npm test)
```

Drift olamaz: TS değiştirmek için ya `.py`'yi değiştirip yeniden üretmek ya da `openapi.generated.ts`'i (uyarıyla) el ile düzenlemek gerekir.

## İçerik

- `openapi.json` — Pydantic'ten üretilmiş OpenAPI 3.1 spec, deterministik anahtar sırası.
- `types/openapi.generated.ts` — `openapi-typescript` çıktısı; el sürülmez.
- `types/product.ts`, `types/agent.ts`, `types/analysis.ts` — generated tiplere alias'lar. Kodun tükettiği isimler burada.
- `types/index.ts` — yukarıdakileri yeniden ihraç eder.
- `demo/demoPayloads.ts` — Üç kanonik fixture (`red`, `yellow`, `green`). Landing demosu, extension fallback'i ve backend testleri aynı verileri kullanır.

## Kullanım

```ts
import { demoPayloads, type AnalyzeResponse } from "@shared/index";

const red = demoPayloads.red.response;
```

Yayın adımı yok; doğrudan path alias ile import edilir.
