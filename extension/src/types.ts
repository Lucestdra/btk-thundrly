/**
 * Shared tipler için convenience re-export.
 * Diğer dosyalar `@shared/...` doğrudan import edebilir; bu modül paketleme
 * sırasında dead-code eliminasyonuna izin veren ince bir köprüdür.
 */

export type {
  AnalyzeRequest,
  AnalyzeResponse,
  Decision,
  Product,
  Review,
  PriceHistoryPoint,
  UserBudget,
  SessionContext,
  AgentResult,
  AgentResultMap,
  AgentFinding,
} from "@shared/types/index";
