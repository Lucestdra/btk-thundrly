# /backend

Thundrly — FastAPI backend. 5 deterministik ajan, tek karar. Fiyat geçmişi
crowdsource veritabanından beslenir (SQLAlchemy + SQLite varsayılan, Postgres
opt-in).

## Çalıştırma

```bash
cd backend

# 1) Sanal ortam
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS/Linux

# 2) Bağımlılıklar
pip install -r requirements.txt

# 3) Sunucu
uvicorn app.main:app --reload
```

- Servis: <http://localhost:8000>
- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>

## Endpoints

| Method | Path | Açıklama |
|---|---|---|
| POST | `/api/analyze-purchase` | 5 ajanla analiz; `priceHistory` boşsa DB'den son 90 günü çeker. |
| POST | `/api/price-observation` | Eklenti her sayfa yüklemesinde fiyat gözlemi gönderir. Rate-limit: 60/dakika/IP. |
| GET  | `/api/health` | Liveness probe. |
| GET  | `/docs` | Swagger UI (üç örnek payload hazır: `red`, `yellow`, `green`). |

Şema: `app/models/schemas.py` (Pydantic v2). `shared/types/analysis.ts` ile birebir aynalanır.

## Veritabanı

İlk açılışta `app/data/observations.db` (SQLite) otomatik yaratılır ve
3 kanonik fixture'ın geçmişiyle seed edilir (yalnızca tablo boşsa).
Postgres'e geçmek için `.env` içinde `DATABASE_URL` ayarla:

```
DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/thundrly
```

Şema bootstrap'i `Base.metadata.create_all` ile yapılır. İlk gerçek
migration gerektiğinde Alembic devreye alınır; çağrı yerleri değişmez.

## Test

```bash
pytest
```

`tests/test_analyze.py` üç fixture'ın doğru eşiğe düştüğünü doğrular.

## Mimari

```
app/
├── main.py              FastAPI + CORS + router include
├── api/
│   └── routes.py        POST /api/analyze-purchase, GET /api/health
├── models/
│   └── schemas.py       Pydantic modelleri (AnalyzeRequest, AnalyzeResponse, ...)
├── agents/
│   ├── review_agent.py  Tekrar, jenerik dil, burst, kısa 5⭐
│   ├── price_agent.py   30/90 günlük ortalama, raise-then-discount
│   ├── budget_agent.py  Aylık + kategori limiti
│   ├── impulse_agent.py Sayfa süresi, tıklama hızı, saat, günlük alım
│   └── decision_agent.py Ağırlıklı toplam → karar + top-3 reasons
├── services/
│   └── orchestrator.py  4 ajanı çalıştırır, karar agentine besler
└── data/
    └── mock_data.py     Üç kanonik örnek (red/yellow/green) — Swagger ve test için
```

## Karar Mantığı

```
risk = 0.30·price + 0.25·review + 0.25·budget + 0.20·impulse
```

| Risk | Karar | Önerilen aksiyon |
|---|---|---|
| 0–39 | green | "Satın almaya devam edebilirsin" |
| 40–69 | yellow | "Birkaç noktayı tekrar gözden geçir" |
| 70–100 | red | "30 saniye düşün" |

## Gelecek — Gerçek Entegrasyon

Her ajan dosyasının başında `TODO (Gemini)` veya `TODO (LangGraph)` bloku vardır. Kısaca:

- `services/orchestrator.py` → LangGraph `StateGraph`; alt ajanlar paralel node, karar agenti fan-in.
- `agents/review_agent.py` → Gemini gömü vektörleri + DBSCAN ile yorum kümeleme.
- `agents/price_agent.py` → Harici fiyat takip kaynaklarından geçmiş verisi.
- `agents/budget_agent.py` → PostgreSQL'den kullanıcı bütçesi ve harcama geçmişi.
- `agents/impulse_agent.py` → Davranışsal model + ürün gezinti geçmişi.

`/.env.example` → `GEMINI_API_KEY`, `LANGGRAPH_TRACING`, `ALLOWED_ORIGINS`.
