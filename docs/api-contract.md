# API Kontratı

> Backend: FastAPI · Şema: Pydantic v2 (`backend/app/models/schemas.py`).
> TypeScript ayna: `shared/types/*.ts`.

Tek aktif endpoint:

## `POST /api/analyze-purchase`

**Açıklama:** Ürün, yorum, fiyat geçmişi, kullanıcı bütçesi ve oturum bilgisini
alır; 5 ajanı çalıştırır; yeşil/sarı/kırmızı bir karar döner.

**Content-Type:** `application/json`

### İstek Şeması

```ts
interface AnalyzeRequest {
  userId: string;
  platform: string;            // "trendyol-demo", "hepsiburada-demo", "n11-demo", ...
  product: {
    title: string;
    price: number;
    originalPrice?: number;
    currency: "TRY" | "USD" | "EUR";
    category: string;
    rating?: number;
    reviewCount?: number;
    url: string;
    imageUrl?: string;
  };
  reviews: Array<{
    rating: number;
    text: string;
    date: string;              // ISO YYYY-MM-DD
    author?: string;
  }>;
  priceHistory: Array<{
    date: string;              // ISO YYYY-MM-DD
    price: number;
  }>;
  userBudget: {
    monthlyLimit: number;
    categoryLimit: number;
    categorySpent: number;
    monthlySpent?: number;
    currency: "TRY" | "USD" | "EUR";
  };
  session: {
    timeOnPageSeconds: number;
    clickSpeedMs: number;
    currentHour: number;       // 0–23
    purchasesToday: number;
    searchedBefore?: boolean;
  };
}
```

### Yanıt Şeması

```ts
type Decision = "green" | "yellow" | "red";
type Severity = "info" | "warn" | "risk";

interface AnalyzeResponse {
  decision: Decision;
  riskScore: number;           // 0–100
  summary: string;             // Türkçe tek cümle
  reasons: string[];           // Türkçe, en güçlü 3
  agents: {
    reviewAgent:   AgentResult;
    priceAgent:    AgentResult;
    budgetAgent:   AgentResult;
    impulseAgent:  AgentResult;
    decisionAgent: AgentResult;
  };
  recommendedAction: string;   // "30 saniye düşün", "Devam edebilirsin", ...
}

interface AgentResult {
  score: number;               // 0–100
  label: string;               // Türkçe etiket
  findings: Array<{ severity: Severity; message: string }>;
}
```

### Örnek — Kırmızı (Red)

Tam payload `shared/demo/demoPayloads.ts` → `redHoodieRequest`.

Yanıt (özet):

```json
{
  "decision": "red",
  "riskScore": 85,
  "summary": "Bu satın alma yüksek riskli görünüyor.",
  "reasons": [
    "7 yorum çiftinde neredeyse aynı ifadeler tekrar ediyor.",
    "Fiyat son 30 gün ortalaması ₺1112'iken indirim öncesi ₺1650'a çıkarılmış.",
    "Bu ay giyim bütçesini zaten %170 oranında aşmış durumdasın."
  ],
  "recommendedAction": "30 saniye düşün"
}
```

### Örnek — Sarı (Yellow)

Tam payload: `yellowHeadphonesRequest`.

```json
{
  "decision": "yellow",
  "riskScore": 48,
  "summary": "Devam etmeden önce birkaç noktayı kontrol et.",
  "reasons": [
    "Fiyat son 30 gün ortalaması ₺1529'iken indirim öncesi ₺1899'a çıkarılmış.",
    "Bu satın alma sonrası elektronik kategorisi limitin %143'üne çıkacak.",
    "Saat 22:00 — geç saatte verilen kararlar daha sık geri iade ediliyor."
  ],
  "recommendedAction": "Birkaç noktayı tekrar gözden geçir"
}
```

### Örnek — Yeşil (Green)

Tam payload: `greenBookRequest`.

```json
{
  "decision": "green",
  "riskScore": 0,
  "summary": "Bu satın alma düşük riskli görünüyor.",
  "reasons": ["Yeterli sinyal bulunamadı."],
  "recommendedAction": "Satın almaya devam edebilirsin"
}
```

### Hata Yanıtları

- `422 Unprocessable Entity` — Pydantic doğrulama hatası (alan eksik/yanlış tip).
  Yanıt: FastAPI'nin standart `detail` formatı.
- `500 Internal Server Error` — Beklenmedik ajan hatası. Eklenti tarafında
  `src/api/client.ts` fallback fixture'a düşer.

## `GET /api/health`

Basit liveness probe.

```json
{ "status": "ok", "service": "kampanya-gercek-mi-backend" }
```

## CORS Politikası

- `http://localhost:3000` (landing dev) ve `http://127.0.0.1:3000` izinli.
- `chrome-extension://*` regex ile tüm eklenti origin'leri izinli.
- Üretimde environment değişkeni `ALLOWED_ORIGINS` ile virgüllü liste verilir.

## Sözleşme Değişiklik Politikası

`AnalyzeRequest` / `AnalyzeResponse` üzerinde değişiklik yapıldığında **üç yer
birden** güncellenmek zorunda:

1. `shared/types/analysis.ts`
2. `backend/app/models/schemas.py`
3. `docs/api-contract.md` (bu dosya)

Test güvenliği için `backend/tests/test_analyze.py` `red`/`yellow`/`green`
fixture'larının doğru eşiğe düştüğünü doğrular; alan kayıpsızlığı pytest'te
yakalanır.
