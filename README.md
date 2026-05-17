# Tartı

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

<!--
  Replace OWNER/REPO with the actual GitHub path once the repo is pushed.
  The badge auto-pulls the latest CI status from .github/workflows/ci.yml.
-->

**Satın almadan önce 5 saniyelik akıllı kontrol.**

Türk e-ticaret kullanıcıları için tasarlanmış, sahte indirimleri, manipüle edilmiş yorumları, bütçe aşımını ve dürtüsel alışveriş riskini tek bir kararda birleştiren AI alışveriş asistanı. Chrome eklentisi olarak çalışır; kullanıcı "Sepete Ekle" veya "Satın Al" düğmesine bastığında devreye girer ve ~5 saniyede yeşil/sarı/kırmızı bir karar verir.

> Bu repo bir MVP iskeletidir. Sentetik demo verileriyle uçtan uca çalışır; gerçek LLM (Gemini) ve LangGraph entegrasyonu, ilgili dosyalarda işaretli TODO'lar olarak bırakılmıştır.

---

## Repo Yapısı

```
Btk/
├── landing/      Next.js 15 tanıtım sitesi + interaktif 5-ajan demosu
├── extension/    Chrome eklentisi (Manifest V3) — buton yakalama + panel
├── backend/      FastAPI + 5 ajan (deterministik mock)
├── shared/       Ortak TypeScript tipleri ve demo payload'ları
└── docs/         Mimari, MVP yol haritası, API kontratı, ürün vizyonu
```

Her klasör bağımsız olarak kurulup çalıştırılır. Monorepo aracı (pnpm workspaces, Turbo vs.) bilinçli olarak kullanılmadı — MVP yüzeyini küçük tutmak için. `shared/` doğrudan TypeScript path alias'ı ile tüketilir; backend Pydantic'te aynalanır.

---

## Hızlı Başlangıç

### Landing Page

```bash
cd landing
npm install
npm run dev
```

→ `http://localhost:3000`

Bütün 10 bölüm + canlı interaktif demo. "Analizi Başlat" → 5 saniyede 5 ajan paralel → kırmızı karar.

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
# source .venv/bin/activate       # macOS/Linux
pip install -r requirements.txt
uvicorn app.main:app --reload
```

→ `http://localhost:8000` · Swagger UI: `/docs`

Test:
```bash
pytest
```

### Extension

```bash
cd extension
npm install
npm run build
```

Sonra Chrome'da:
1. `chrome://extensions` → **Geliştirici modu** açık
2. **Paketlenmemiş öğe yükle** → `extension/dist/` seç
3. Eklenti ID'sini kopyala
4. `chrome-extension://<id>/public/demo-product.html` aç
5. "Sepete Ekle" → panel açılır, ~5s analiz, kırmızı karar

> Backend kapalı olsa bile eklenti `shared/demo` fallback fixture'ı ile çalışmaya devam eder.

---

## Ne Yapıldı?

- ✅ **Landing page** — 10 bölüm, interaktif 5-ajan demosu, mobil responsive, Framer Motion animasyonları, premium dark tema. Tüm metinler Türkçedir.
- ✅ **Backend** — FastAPI + Pydantic v2; 5 deterministik ajan (review, price, budget, impulse, decision); ağırlıklı toplam + eskalasyon kuralı; 3 fixture için pytest doğrulaması.
- ✅ **Extension** — Manifest V3, content-script yakalama (capture-phase), shadow-DOM panel (host sayfa stillerinden izole), backend client + fallback fixture, "Devam Et" bypass akışı.
- ✅ **Shared** — `AnalyzeRequest` / `AnalyzeResponse` tipleri; 3 kanonik demo payload (red/yellow/green) hem TS hem Python tarafında aynı verilerle.
- ✅ **Docs** — Mimari, MVP yol haritası, API kontratı, ürün vizyonu — hepsi Türkçe.

## Neler Mock'lanıyor?

| Bileşen | MVP (mock) | Üretim |
|---|---|---|
| Yorum analizi | Jaccard token tekrar + jenerik dil + burst tespiti | Gemini embeddings + DBSCAN kümeleme |
| Fiyat analizi | İstek payload'undaki geçmiş | Harici fiyat takip servisi |
| Bütçe analizi | İstek payload'undaki sayılar | PostgreSQL kullanıcı bütçesi |
| Dürtü analizi | Süre + tıklama hızı + saat + günlük alım | Davranışsal model + Gemini bağlamı |
| Orkestrasyon | Senkron `orchestrator.analyze()` | LangGraph StateGraph (paralel node'lar) |
| Yorum DB | Yok | pgvector + Gemini embedding'leri |
| Erken erişim e-posta | Local React state | PostgreSQL + transaktif e-posta |
| Eklenti seçicileri | Demo sayfası `[data-kg-buy]` + Trendyol/Hepsiburada/N11 stub'ları | Uzaktan yapılandırılabilir seçici paketi |

Detaylar: [docs/architecture.md](docs/architecture.md).

## Bilinen Sınırlar

- Gerçek LLM çağrısı yok; ajanlar deterministik fonksiyonlar.
- Veritabanı yok; bütçe verisi her istekte sıfırdan gelir.
- Erken erişim e-posta formu yenilemeyle silinir (local state).
- Eklenti gerçek e-ticaret sayfalarında stub seçicilerle sınırlıdır; demo sayfada tam çalışır.
- İkon PNG'leri yok — Chrome varsayılan ikonu kullanılır. `extension/public/icons/README.md` üretim adımlarını listeler.
- Yalnızca Türkçe arayüz (tasarım gereği).

## Sonraki Adımlar

[docs/mvp-roadmap.md](docs/mvp-roadmap.md) iki haftalık plana göre, sırasıyla:

1. **Gerçek seçiciler** — Trendyol/Hepsiburada/N11 için CDN-hosted JSON paket.
2. **Gemini entegrasyonu** — `review_agent.py` LLM kümeleme + `decision_agent.py` doğal Türkçe gerekçeleri.
3. **LangGraph orkestratörü** — Alt ajanlar paralel node, karar agentine fan-in.
4. **PostgreSQL + pgvector** — Kullanıcı + bütçe + yorum embedding'leri.

## Sözleşme Değişiklikleri

`AnalyzeRequest` / `AnalyzeResponse` değişirse **üç yer birden** güncellenmek zorunda:

1. `shared/types/analysis.ts`
2. `backend/app/models/schemas.py`
3. `docs/api-contract.md`

Test güvenliği: `backend/tests/test_analyze.py` üç fixture'ın doğru eşiğe düştüğünü doğrular.

## Lisans

MVP / demo amaçlı. Kullanıma uygunluk için ayrı bir lisans dosyası eklenecektir.
