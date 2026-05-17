# Icons

Manifest V3 PNG ikonları (16, 48, 128 piksel). MVP scaffold için bu klasör boştur; ikonlar
build sırasında manifest tarafından beklenir. İki çözüm:

1. **Hızlı yol** — herhangi bir 128×128 PNG'yi üç boyutta resample ederek bu klasöre at:
   - `icon-16.png`
   - `icon-48.png`
   - `icon-128.png`

2. **Önerilen** — `landing/components/shell/Nav.tsx` içindeki "K" logosunu kullan:
   - 32×32 SVG'yi (mor-cyan gradient) PNG'ye export et
   - Üç boyutta sample alıp aynı isimlerle kaydet

İkonlar olmadan Chrome `chrome://extensions` sayfasında eklentiyi yine yükler ancak
varsayılan gri yer tutucu gösterir. Demo akışını engellemez.
