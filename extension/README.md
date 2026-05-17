# /extension

Kampanya Gerçek mi? — Chrome Manifest V3 eklentisi. Türk e-ticaret sitelerinde
"Sepete Ekle" / "Satın Al" tıklamalarını yakalar, AI analiz panelini gösterir.

## Çalıştırma

```bash
cd extension
npm install
npm run build
```

Sonra Chrome'da:

1. `chrome://extensions` aç.
2. Sağ üstte **Geliştirici modunu** aç.
3. **Paketlenmemiş öğe yükle** → `extension/dist/` klasörünü seç.
4. Eklenti listesinde "Kampanya Gerçek mi?" ikonunu (varsayılan) gör.
5. Test için: yüklü eklentinin ID'sini kopyala, şu adresi aç:

```
chrome-extension://<eklenti-id>/public/demo-product.html
```

6. "Sepete Ekle" veya "Hemen Al" düğmesine bas — panel açılacak, ~5 saniye
   boyunca analiz simülasyonu çalışacak, kırmızı kararı gösterecek.
   - `Devam Et` → orijinal tıklama yeniden tetiklenir.
   - `30 Saniye Düşün` → panel kapanır, satın alma iptal.
   - `Analizi Kapat` → panel kapanır, satın alma yapılmaz.

## Backend Olmadan Çalışır

Backend ayakta değilse `src/api/client.ts` `shared/demo/demoPayloads.ts` içindeki
`redHoodieResponse` fixture'ını kullanır. Eklenti her durumda işlev görür; bu
yatırımcı demosu sırasında network sorunlarına dayanıklılık sağlar.

Backend ayaktayken (`uvicorn` çalışırken):
- Service worker `http://localhost:8000/api/analyze-purchase` adresine POST atar.
- Gerçek 5-ajan analizi sonucu döner.
- CORS `chrome-extension://*` için açıktır.

## Yapı

```
extension/
├── manifest.json                  MV3 + content_scripts (trendyol, hepsiburada, n11, demo)
├── src/
│   ├── background.ts              service worker — backend fetch ve mesaj relay
│   ├── contentScript.ts           buton yakalama + panel mount + bypass akışı
│   ├── panel/
│   │   ├── App.tsx                Loading/result/error durumları
│   │   ├── Panel.css              Shadow DOM içinde host sayfadan izole stil
│   │   └── mount.tsx              Shadow root + React root oluşturucu
│   ├── utils/
│   │   ├── domDetector.ts         Per-host seçici tabloları + metin fallback'i
│   │   └── productExtractor.ts    JSON-LD + OG meta + demo data-attr ekstraksiyonu
│   ├── api/
│   │   └── client.ts              chrome.runtime.sendMessage wrapper + fallback
│   └── types.ts                   (ileride re-export'lar için yer tutucu)
├── public/
│   ├── demo-product.html          Sentetik Trendyol-stili demo sayfası
│   └── icons/                     Manifest ikonları (üretildiğinde eklenmeli — bkz. README)
├── vite.config.ts                 Vite + @crxjs/vite-plugin
├── tailwind.config.cjs            Sadece panel CSS için
├── postcss.config.cjs
└── tsconfig.json                  @shared/* → ../shared/* alias'ı
```

## Bilinen Sınırlar

- **Seçiciler stale olur**: `domDetector.ts` içindeki Trendyol/Hepsiburada/N11
  butonları için statik seçiciler yıkıcı değişikliklerde çalışmayı durdurur.
  Üretim için uzaktan yapılandırılabilir (örn. CDN'den günde bir kez çekilen)
  bir seçici paketi öneriliyor.
- **Ürün ekstraksiyonu kısmi**: MVP gerçek e-ticaret sayfalarında ürün başlığı,
  fiyat, kategori için JSON-LD ve OG meta'ya güveniyor. Yorumlar, fiyat geçmişi
  ve kullanıcı bütçesi sentetik fixture'dan geliyor — gerçek üretimde bunlar
  arka uçtan / kullanıcı oturumundan gelmeli.
- **İkonlar**: `public/icons/` boş. Eklenti varsayılan Chrome ikonuyla yüklenir.
  `public/icons/README.md` üretim adımlarını listeler.

## Manifest Eşleştirmeleri

- `*://*.trendyol.com/*`, `*://*.hepsiburada.com/*`, `*://*.n11.com/*` —
  içerik komut dosyası bu üç host için otomatik enjekte edilir.
- `<all_urls>` + `include_globs: ["*demo-product.html*"]` — yerel demo sayfası
  her host altında çalışır.
- `host_permissions` — `http://localhost:8000/*` backend için.

## Şu An İçin Mock'lanan

| Bileşen | Mock | TODO |
|---|---|---|
| Yorum verisi | `redHoodieRequest.reviews` | Gerçek sayfa yorum scraping'i |
| Fiyat geçmişi | `redHoodieRequest.priceHistory` | Üçüncü taraf fiyat takip servisi |
| Bütçe verisi | `redHoodieRequest.userBudget` | Kullanıcı oturumu + PostgreSQL |
| Session ölçümleri | `clickSpeedMs: 420` sabit | Gerçek timestamp/event delta |
