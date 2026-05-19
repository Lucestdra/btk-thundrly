import { describe, expect, it } from "vitest";

import { isCheckoutSuccessPage } from "@/utils/purchaseTracker";

describe("purchase completion detection", () => {
  it("detects Turkish order confirmation copy", () => {
    expect(
      isCheckoutSuccessPage(
        "trendyol",
        "https://www.trendyol.com/sepetim/odeme-sonuc",
        "Siparişiniz alındı. Ödemeniz başarıyla tamamlandı.",
      ),
    ).toBe(true);
  });

  it("detects common success URLs when the page also mentions an order", () => {
    expect(
      isCheckoutSuccessPage(
        "amazon",
        "https://www.amazon.com.tr/checkout/order-confirmation?orderId=123",
        "Order placed. Thank you for your order.",
      ),
    ).toBe(true);
  });

  it("does not treat normal product pages as purchases", () => {
    expect(
      isCheckoutSuccessPage(
        "hepsiburada",
        "https://www.hepsiburada.com/kulaklik-p-HBCV123",
        "Sepete ekle. Teslimat ve ödeme seçeneklerini gör.",
      ),
    ).toBe(false);
  });

  it("ignores unsupported hosts", () => {
    expect(
      isCheckoutSuccessPage(
        "unknown",
        "https://example.com/thank-you",
        "Thank you for your order.",
      ),
    ).toBe(false);
  });
});
