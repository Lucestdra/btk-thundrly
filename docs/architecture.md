# Mimari

> Kampanya Gerçek mi? — Türk e-ticaret için 5 ajanlı satın alma analiz asistanı.
> Bu belge MVP mimarisini ve gerçek üretime giden yolu açıklar.

## Genel Resim

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Landing Page   │     │ Chrome Extension │     │ FastAPI Backend     │
│ Next.js 15     │     │ Manifest V3      │     │ Python + Pydantic   │
│ Tanıtım + Demo │     │ Yakalama + Panel │     │ 5 Ajan Orkestrasyon │
└────────┬───────┘     └─────────┬────────┘     └──────────┬──────────┘
         │                       │                         │
         │                       │  POST /api/analyze-…    │
         │                       └────────────────────────►│
         │                                                 │
         │  (statik demo)                                  │
         └────────────────────────► shared/demo/demoPayloads.ts
                                          ▲                │
                                          │                │ (mirrored)
                                          └────────────────┘
                                          shared/types/*.ts
                                          backend/app/models/schemas.py
```

Üç bileşen aynı sözleşme (`AnalyzeRequest` / `AnalyzeResponse`) etrafında buluşur.
Landing demosu sözleşmeyi statik olarak gösterir; eklenti backend'i çağırır
(veya fallback fixture'ı kullanır); backend deterministik mock ajanları çalıştırır.

## Veri Akışı — Eklenti

```
1. Kullanıcı Trendyol/Hepsiburada/N11 ürün sayfasında "Sepete Ekle" tıklar.
2. contentScript.ts capture-phase listener'ı tıklamayı yakalar:
     event.preventDefault() + stopImmediatePropagation()
3. productExtractor.ts ürün payload'ını oluşturur:
     - JSON-LD → Product schema
     - <meta property="og:*"> → fallback
     - demo sayfasında [data-kg-*] attribute'ları → kesin değerler
4. mount.tsx shadow-DOM içinde React paneli mount eder.
5. Panel chrome.runtime.sendMessage({type: "analyze", payload}) gönderir.
6. background.ts service worker:
     fetch("http://localhost:8000/api/analyze-purchase", {body: payload})
7. Backend orchestrator → 4 alt ajan → karar ajanı → AnalyzeResponse.
8. Panel sonucu gösterir; kullanıcı seçer:
     - "Devam Et" → data-kg-bypass=1; setTimeout(() => btn.click(), 0)
     - "30 Saniye Düşün" → panel kapanır, satın alma iptal
     - "Analizi Kapat" → panel kapanır, satın alma iptal
```

Backend ulaşılamazsa `src/api/client.ts` `shared/demo` fallback fixture'ını
döner — eklenti her zaman çalışır.

## Ajan Sistemi

```
                ┌──────────────────────────┐
                │   POST /analyze-purchase │
                │   AnalyzeRequest         │
                └────────────┬─────────────┘
                             │
                             ▼
            ┌────────────────────────────────────┐
            │   services/orchestrator.analyze    │
            └────────────┬───────────────────────┘
                         │
        ┌────────────────┼────────────────┬──────────────┐
        ▼                ▼                ▼              ▼
  review_agent     price_agent      budget_agent   impulse_agent
   (25% ağırlık)   (30% ağırlık)    (25% ağırlık)  (20% ağırlık)
        │                │                │              │
        └────────────────┴────────┬───────┴──────────────┘
                                  │
                                  ▼
                      ┌──────────────────────┐
                      │   decision_agent.run │
                      │  ağırlıklı toplam +  │
                      │  eskalasyon kuralı   │
                      └──────────┬───────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   AnalyzeResponse      │
                    │   { decision, risk,    │
                    │     summary, reasons,  │
                    │     agents, action }   │
                    └────────────────────────┘
```

### Eşik ve Eskalasyon

Ağırlıklı toplam:
```
risk = 0.30·price + 0.25·review + 0.25·budget + 0.20·impulse
```

Karar eşikleri:
- 0–39 → **green**
- 40–69 → **yellow**
- 70–100 → **red**

**Eskalasyon kuralı**: Tek bir ajan çok güçlü sinyal veriyorsa ağırlıklı toplam
düşük olsa bile kararı yükselt. Bir boyutta net risk varken diğerleri sıfırsa
sinyalin kaybolmaması için.
- `single_max ≥ 80` → risk en az 70 (red zorunlu)
- `single_max ≥ 45` → risk en az 42 (yellow zorunlu)

## Mock vs. Gerçek

| Boyut | MVP (mock) | Üretim (planlanan) |
|---|---|---|
| Yorum analizi | Jaccard token tekrar tespiti + jenerik ifade listesi + burst | Gemini embeddings + DBSCAN kümeleme + LLM özeti |
| Fiyat analizi | İstek payload'undaki fiyat geçmişi + statistical functions | Harici fiyat takip servisi + uzun vadeli zaman serisi |
| Bütçe analizi | İstek payload'undaki bütçe sayıları | PostgreSQL: kullanıcı + aylık + kategori bazlı harcama geçmişi |
| Dürtü analizi | Sayfa süresi + tıklama hızı + saat + günlük alım kural seti | Davranışsal model + tarayıcı geçmişi (yerel) + LLM bağlamı |
| Karar orkestrasyonu | Senkron orchestrator.analyze() | LangGraph StateGraph; alt ajanlar paralel node, decision_agent fan-in |
| Yorum & yorum vektörleri | Yok | pgvector + Gemini embeddings |
| Kullanıcı + bütçe | Payload | PostgreSQL: users, budgets, purchases |
| Erken erişim e-postaları | Local React state (kaybolur) | PostgreSQL + transactional e-posta servisi |

## Tasarım Tradeoff'ları

- **No monorepo tooling**: pnpm workspaces veya Turbo yerine bağımsız üç klasör.
  Hackathon-ölçekli MVP için ekstra yüzey alanı yaratmamak için. `shared/` doğrudan
  path alias ile tüketilir; backend Pydantic'te aynalanır.
- **CSS 3D over React Three Fiber**: Ajan akış diyagramı için R3F yerine SVG +
  Framer Motion. Bundle %40 daha küçük, dev maliyeti ~%80 daha düşük; 3D-his hala
  korunuyor.
- **Shadow DOM panel**: Host sayfanın CSS'inden tam izolasyon. Eklenti paneli
  hiçbir e-ticaret sayfasının stil kuralından etkilenmez.
- **Deterministik mock ajanlar**: Gemini API çağrısı yok. Her demo çalışmasında
  aynı sonuç. Yatırımcı demosunda öngörülebilirlik > LLM yaratıcılığı.
- **Bypass akışı (extension)**: "Devam Et"e basıldığında orijinal click yeniden
  fire ediliyor — kendi navigation/cart logic'ini implement etmek yerine. Site
  ne yapıyorsa onu yapar.

## Gerçek Entegrasyon Adımları (Sonraki Sprint)

1. **Gemini entegrasyonu** (`backend/.env` → `GEMINI_API_KEY`):
   - `review_agent.py` → metinleri embedding'e çevir, DBSCAN ile küme bul,
     LLM özeti iste.
   - `decision_agent.py` → "3 reasons" LLM tarafından yeniden ifade edilsin
     (daha doğal Türkçe).

2. **LangGraph orkestratörü** (`services/orchestrator.py`):
   ```python
   from langgraph.graph import StateGraph
   graph = StateGraph(AnalysisState)
   graph.add_node("review_node", review_agent.run)
   graph.add_node("price_node",  price_agent.run)
   graph.add_node("budget_node", budget_agent.run)
   graph.add_node("impulse_node", impulse_agent.run)
   graph.add_node("decision_node", decision_agent.run)
   # paralel: review_node, price_node, budget_node, impulse_node → decision_node
   ```

3. **PostgreSQL**:
   - `users`, `budgets`, `purchases`, `analyses` tabloları
   - Eklenti üzerinden gelen istekler `userId` doğrulaması yapsın
   - `analyses` her sonucu loglasın → ileride model fine-tuning ve A/B testi için

4. **Vector DB (pgvector)**:
   - Yorum embedding'leri için
   - "Bu yorum daha önce gördüğümüz hangi şüpheli kümeye benziyor?" sorgusu

5. **Eklenti seçici paketi**:
   - Trendyol/Hepsiburada/N11 seçicileri için CDN-hosted JSON
   - `extension/src/utils/domDetector.ts` build sırasında bunu fetch edip embed eder

## Güvenlik Notları

- Eklenti panel'i shadow DOM içinde — XSS sızıntısı host sayfaya geçmez.
- Backend CORS yalnızca `localhost:3000` ve `chrome-extension://*` kabul eder.
- MVP'de kullanıcı kimliği yok; üretimde Gemini'a yorumlar gönderilirken
  kişisel bilgi (kullanıcı adı vb.) filtrelenmeli.
