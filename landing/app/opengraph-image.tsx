/**
 * Next.js auto-generates `/opengraph-image` from this file at build
 * time. Same React subset that `next/og` supports — flexbox, basic CSS,
 * no animations, no SSR-only browser APIs.
 *
 * Same content is reused for the Twitter card.
 */

import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt =
  "Tartı — Satın almadan önce 5 saniyelik akıllı kontrol";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "84px",
          backgroundImage:
            "linear-gradient(135deg, #ccdbdc 0%, #9ad1d4 60%, #80ced7 100%)",
          color: "#003249",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "18px",
              background: "#007ea7",
              color: "#003249",
              fontSize: "44px",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              letterSpacing: "-0.04em",
            }}
          >
            T
          </div>
          <div style={{ fontSize: "44px", fontWeight: 500, color: "#003249" }}>
            Tartı
          </div>
        </div>

        <div
          style={{
            fontSize: "84px",
            fontWeight: 300,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            maxWidth: "960px",
          }}
        >
          Satın almadan önce 5 saniyelik akıllı kontrol.
        </div>

        <div
          style={{
            marginTop: "40px",
            fontSize: "28px",
            color: "rgba(0, 50, 73, 0.72)",
            maxWidth: "920px",
            lineHeight: 1.35,
          }}
        >
          Yorum manipülasyonu, sahte indirim ve bütçe aşımını tek bir karar
          rengiyle gösterir — yeşil, sarı veya kırmızı.
        </div>
      </div>
    ),
    size,
  );
}
