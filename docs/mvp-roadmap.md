# MVP Yol Haritası — İki Hafta

> Hedef: Yatırımcı / juri demosu seviyesinde, görsel ve teknik olarak inandırıcı
> bir ürün temeli. Gerçek LLM/PG entegrasyonu için temiz uzatma noktaları.

## Hafta 1 — Temel ve Görsel İskele

| Gün | Çıktı | Durum |
|---|---|---|
| 1 | Proje yapısı (`landing/`, `extension/`, `backend/`, `shared/`, `docs/`) | ✅ Bu repo |
| 1-2 | `shared/types/*.ts` + `shared/demo/demoPayloads.ts` üç kanonik fixture | ✅ |
| 2-4 | Landing page — 10 bölüm + interaktif 5-ajan demosu | ✅ |
| 4-5 | Backend — FastAPI + Pydantic + 5 deterministik ajan + pytest | ✅ |
| 5-7 | Extension iskeleti — manifest, content-script, panel, backend client | ✅ |

## Hafta 2 — Entegrasyon ve Demo Akışı

| Gün | Çıktı | Durum |
|---|---|---|
| 8 | Eklenti gerçek tıklama yakalama + shadow-DOM panel + bypass akışı | ✅ |
| 8-9 | Eklenti → backend → demo akışı uçtan uca test | ⏳ (yerel doğrulama) |
| 9-10 | Trendyol/Hepsiburada/N11 için ilk gerçek seçici denemeleri | ⏳ |
| 10-11 | Gemini API entegrasyonu — `review_agent` ve `decision_agent` reasons üretimi | ⏳ |
| 11-12 | LangGraph orkestratörü — paralel ajan node'ları | ⏳ |
| 12-13 | Polish — animasyon ince ayarları, mobil responsive QA, copy revize | ⏳ |
| 13-14 | Yatırımcı demo akışı — sunum sırası, ekran kaydı, fallback plan | ⏳ |

## Hafta 2'de Karar Verilecek Konular

- **Yorum scraping**: gerçek sayfada DOM'dan mı, yoksa Trendyol/Hepsiburada
  açık API'lerinden mi? Yasal risk vs. veri kalitesi.
- **Kullanıcı bütçesi**: ilk kullanıma giriş ekranında mı sorulacak, yoksa
  ürün kategorisine göre Türkiye ortalamasıyla mı başlatılacak?
- **Telemetri**: hangi kararlar verildi, kullanıcı kaç kez "Devam Et"e bastı?
  Bu veri model fine-tuning için kritik ama gizlilik politikası gerektirir.

## Demo Akışı (Yatırımcıya Sunum)

Her segment ~30 saniye:

1. **Hook (15s)** — Türk e-ticaret kampanya sezonunda 3 büyük problem (sahte
   indirim, manipüle yorum, dürtüsel alışveriş). Landing hero.
2. **Çözüm gösterimi (30s)** — Landing "Canlı Demo" bölümünde "Analizi Başlat"
   → 5 saniyede 5 ajan paralel → kırmızı karar + 3 gerekçe.
3. **Eklenti gerçeği (45s)** — Sentetik demo sayfasında "Sepete Ekle" tıkla,
   shadow-DOM panel açılır, backend ulaşılır, kararı gösterir.
4. **Mimari (30s)** — Slayt: LangGraph + Gemini + FastAPI yığını. Vurgu:
   "Üretime ölçeklenebilir bir temel."
5. **Şu an ne çalışıyor? (30s)** — "MVP sentetik verilerle uçtan uca çalışır.
   Hafta 2'de gerçek Gemini ve LangGraph entegrasyonu."
6. **Soru-Cevap fallback**:
   - "İndirim verisi nereden?" → "MVP'de payload; üretimde Pricezilla benzeri
     servis veya kendi crawler'ımız."
   - "Bütçe mahremiyeti?" → "Veri yerel; sunucu yalnızca sayıları görür, kim
     ne aldı bilgisi tutulmaz."
