/**
 * Per-platform CSS selector packs for product extraction.
 *
 * Real Turkish e-commerce sites change DOM frequently; we list multiple
 * selectors per field in priority order. First match wins. If all selectors
 * miss, the higher-level extractor falls back to JSON-LD / microdata /
 * og:meta in order.
 *
 * These selectors are best-effort against the platforms as of early 2026.
 * For production, this whole module is a strong candidate to load from a
 * remote-config JSON so it can be updated without a Chrome Store release.
 */

import type { Host } from "./domDetector";

export interface PlatformPack {
  title: string[];
  price: string[];
  originalPrice: string[];
  category: string[];
  rating: string[];
  reviewCount: string[];
  imageUrl: string[];
  reviews?: ReviewSelectors;
}

export interface ReviewSelectors {
  /** Per-review wrapper. Each match is parsed as one Review. */
  container: string[];
  /** Element bearing the numeric rating (in textContent or an attr). */
  rating?: string[];
  /** Element holding the review body text. */
  text: string[];
  /** Element holding the date (ISO or platform-native string). */
  date?: string[];
  /** Maximum reviews to extract per page (cap on payload size). */
  maxItems?: number;
}

export const PLATFORM_PACKS: Partial<Record<Host, PlatformPack>> = {
  trendyol: {
    title: [
      "h1[data-testid='product-title']",
      "h1.pr-new-br span",
      "h1.pr-new-br",
      ".product-detail-name",
      "h1.product-name",
    ],
    price: [
      ".prc-dsc",
      ".product-price-container .price-view-current",
      ".product-price-container .prc-slg",
      "[data-test-id='price-current-price']",
      ".price-current",
    ],
    originalPrice: [
      ".prc-org",
      ".product-price-container .price-view-original",
      ".price-original",
      ".prc-box-orgnl",
    ],
    category: [
      ".breadcrumb-content a:last-of-type",
      ".product-detail-breadcrumb-link:last-of-type",
      ".breadcrumb li:nth-last-child(2) a",
    ],
    rating: [
      ".product-rating-score .value",
      ".pr-rnr-rating",
      "[data-testid='product-rating']",
      ".rating-line-count",
    ],
    reviewCount: [
      ".total-review-count",
      ".pr-rnr-cn",
      "[data-testid='review-count']",
    ],
    imageUrl: [
      ".gallery-modal-content img",
      ".product-image img",
      "img.product-detail-img",
    ],
    reviews: {
      container: [
        ".comment-item",
        ".pr-rnr-cm-itm",
        "[class*='ReviewsList-item']",
      ],
      rating: [
        ".comment-rating",
        ".pr-rnr-com-r",
        "[class*='star']",
      ],
      text: [
        ".comment-text",
        ".pr-xc-w",
        "[class*='ReviewCard-text']",
      ],
      date: [
        ".comment-date",
        ".pr-rnr-com-d",
        "time",
      ],
      maxItems: 25,
    },
  },

  hepsiburada: {
    title: [
      "h1[data-test-id='title']",
      "h1.product-name",
      "h1[itemprop='name']",
      ".product-detail h1",
    ],
    price: [
      "[data-test-id='price-current-price']",
      "[data-test-id='default-price']",
      "span[itemprop='price']",
      ".product-price",
      "[data-bind*='priceFormatter']",
    ],
    originalPrice: [
      "[data-test-id='price-prev-price']",
      ".price-prev",
      ".old-price",
      "del.product-old-price",
    ],
    category: [
      ".breadcrumb-list li:last-of-type a",
      ".breadcrumb li:nth-last-child(2) a",
      "[itemprop='itemListElement']:last-of-type [itemprop='name']",
    ],
    rating: [
      "[data-test-id='ratingScore']",
      ".rating-star span",
      "[itemprop='ratingValue']",
    ],
    reviewCount: [
      "[data-test-id='reviewCount']",
      ".review-count",
      "[itemprop='reviewCount']",
    ],
    imageUrl: [
      "#productImage img",
      ".product-image img",
      "img[data-test-id='product-image']",
    ],
    reviews: {
      container: [
        "[data-test-id='review-item']",
        ".reviews-list-item",
        ".user-reviews .review",
      ],
      rating: [
        "[data-test-id='review-rating']",
        "[itemprop='ratingValue']",
        ".review-stars",
      ],
      text: [
        "[data-test-id='review-text']",
        ".review-text",
        ".review-content",
      ],
      date: [
        "[data-test-id='review-date']",
        ".review-date",
        "time",
      ],
      maxItems: 25,
    },
  },

  n11: {
    title: [
      "h1.proName",
      ".product-detail-title h1",
      "h1[itemprop='name']",
      ".unf-p-summary-info h1",
    ],
    price: [
      ".newPrice ins",
      ".unf-p-new-price",
      ".product-price ins",
      "span[itemprop='price']",
      ".priceContainer .newPrice",
    ],
    originalPrice: [
      ".oldPrice del",
      ".unf-p-old-price",
      ".product-price del",
      ".oldPriceDetail",
    ],
    category: [
      ".breadCrumb li:last-of-type a",
      ".product-detail-breadcrumb a:last-of-type",
      ".unf-bread-item:last-of-type",
    ],
    rating: [
      ".ratingCont .ratingScore",
      ".rating-detail .point",
      "[itemprop='ratingValue']",
    ],
    reviewCount: [
      ".comment-count",
      ".reviewCountLink",
      "[itemprop='reviewCount']",
    ],
    imageUrl: [
      ".unf-p-img img",
      "#productMainImg img",
      ".productMainPic img",
    ],
    reviews: {
      container: [
        ".commentList .commentBox",
        ".comment-list .comment",
        "[class*='commentItem']",
      ],
      rating: [
        ".ratePoint",
        ".comment-stars",
        "[itemprop='ratingValue']",
      ],
      text: [
        ".commentDetail",
        ".comment-text",
      ],
      date: [
        ".commentDate",
        ".comment-date",
      ],
      maxItems: 25,
    },
  },
};

export const DEMO_REVIEW_SELECTORS: ReviewSelectors = {
  // Demo product page is a static HTML file under our control — see
  // `public/demo-product.html`. Each review has explicit data-attrs so
  // extraction is deterministic regardless of CSS-class drift.
  container: ["[data-kg-review]"],
  rating: ["[data-kg-rating]"],
  text: ["[data-kg-review-text]"],
  date: [".review-date", "[data-kg-review-date]"],
  maxItems: 50,
};
