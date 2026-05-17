# Ürün Vizyonu

## Tek Cümle

> Türk online tüketicisinin satın almadan önce 5 saniyede daha iyi bir karar
> vermesini sağlayan, çoklu-ajan tabanlı bir AI alışveriş asistanı.

## Sorun

Türk e-ticaret pazarı 2020'den bu yana hızla büyürken üç sorun birlikte büyüdü:

1. **Sahte indirimler** — Kampanya öncesi yükseltilen fiyatlar, manipüle edilmiş
   "eski fiyat" etiketleri, dakika başı değişen psikolojik fiyat oyunları.
2. **Manipüle edilmiş yorumlar** — Aynı cümleler farklı hesaplardan tekrar ediyor;
   5 yıldız + tek satır yorum patlamaları çoğu yerde sıradan hale geldi.
3. **Dürtüsel alışveriş** — Geç saatte hızla verilen kararlar, kampanya
   bombardımanı altında kategori bütçesinin sürekli aşılması.

Mevcut araçlar bu üç problemi **ayrı ayrı** çözmeye çalışıyor:
- Fiyat takip uygulamaları (sahte indirim için)
- Yorum analiz eklentileri (manipüle yorum için)
- Bütçe uygulamaları (harcama disiplini için)

Hiçbiri Türk e-ticaret bağlamına özgü değil; üçü birden tek bir karar anında
hizmet etmiyor.

## Çözüm

**Kampanya Gerçek mi?**, üç problemi tek bir karar anında — "Sepete Ekle"
tıklamasından sonraki 5 saniyede — birleştirir:

- 5 ajan paralel çalışır (yorum, fiyat, bütçe, dürtü, karar orkestratörü)
- Ürünü, geçmişini ve **kullanıcıyı** dikkate alır
- Karmaşıklığı kullanıcıdan saklar
- Tek bir karar verir: yeşil, sarı veya kırmızı
- Yargılamaz; "30 saniye düşün" seçeneğini sunar, son kararı kullanıcıya bırakır

## Kullanıcı Vaadi

> "Satın almadan önce 5 saniyelik akıllı kontrol."

Eklenti her zaman 5 saniyenin altında karar verir, çünkü her ajan tek bir
boyuta odaklanır ve karar orkestratörü ağırlıklı toplamı anında üretir.

## Hedef Kullanıcı

- **Yaş**: 22–45
- **Konum**: Türkiye
- **Davranış**: Ayda en az 3 kez online alışveriş; Chrome kullanıcısı; kampanya
  sezonlarında karar yorgunluğu yaşıyor.
- **Motivasyon**: Harcamasını bilinçli yönetmek istiyor; sahte indirimlerin
  bilincinde ama her ürünü kendi başına analiz edecek zamanı yok.

## Neden Şimdi?

- Türk e-ticaret hacmi son 4 yılda 4× büyüdü; kampanya yorgunluğu artıyor.
- Genel LLM'ler ve embedding modelleri ucuzladı; çoklu-ajan mimarisi artık
  pratik bir mühendislik tercihi.
- Manifest V3 ile Chrome eklentilerinin güvenlik modeli olgunlaştı.
- Türkçe doğal dil modelleri yeterince iyi: Gemini, Claude ve yerli modeller
  Türkçe yorum analizinde tatmin edici sonuçlar veriyor.

## Başarı Metrikleri (Lansman sonrası 90 gün)

Erken sinyal niteliğindeki ölçütler:
- "30 Saniye Düşün"'e basma oranı (yüksek = ürün kullanıcıya değer veriyor)
- Eklenti gösterildikten sonra sepetten vazgeçme oranı (ürün vaadinin gerçekten
  pişmanlık azaltıp azaltmadığının ilk kanıtı)
- Haftalık aktif kullanıcı (WAU) — eklentinin kullanıcının alışveriş ritminin
  bir parçası olup olmadığı

İleride önemli olacak:
- Kırmızı kararların kullanıcı geri iade davranışıyla korelasyonu
- Kategori bazlı doğruluk (giyim vs. elektronik vs. kitap)

## Tasarım İlkeleri

1. **Sade karar, derin gerekçe**. Karar yeşil/sarı/kırmızı; gerekçe genişletilebilir.
2. **Yargılayıcı dil yok**. "Bunu almamalısın" değil, "Bu ay giyim bütçeni
   %170 aştın" — kararı kullanıcı verir.
3. **Hız > yaratıcılık**. LLM'in özgür gerekçe üretmesi yerine deterministik
   şablonlar; gerçek LLM yalnızca dil revizesi için kullanılır.
4. **Veri minimalizmi**. Sunucuda kullanıcı kimliği veya satın alma geçmişi
   uzun süre tutulmaz. Yalnızca anlık karar için gerekenler.
5. **Türkçe-öncelikli**. Tüm ifadeler Türk e-ticaret diline göre kalıplaştı
   ("Sepete Ekle", "Hemen Al", "Kampanya bitiyor!") — çeviri değil, üretim.

## Ne Yapmıyoruz?

- Satın alma kararını kullanıcı için **vermiyoruz**. Önceden uyarıyoruz.
- Fiyat manipülasyonunu yapan satıcıyı **rapor etmiyoruz**. Bu, ileride
  platformlarla iş ortaklığı gerektirir — başlangıçta odakta değil.
- Kullanıcı davranışını **uzun süre depolamıyoruz**. Eklenti yereldir; backend
  yalnızca anlık karar için gerekenleri alır.
- Affiliate link / komisyon **almıyoruz**. Tarafsızlık ürün vaadinin temelidir.
