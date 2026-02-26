import type { MarketMapping, MarketSnapshot } from "@/types";

/**
 * Lightweight fetch-like signature used for dependency injection and testability.
 */
export type HttpFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Normalized market view consumed by the app.
 */
export interface MarketData {
  impliedProbA: number;
  impliedProbB: number;
  volume: number;
  status: MarketMapping["status"];
}

/**
 * Options for Polymarket API integration.
 */
export interface PolymarketClientOptions {
  /**
   * API base URL.
   * Default: https://gamma-api.polymarket.com
   */
  baseUrl?: string;
  /**
   * Minimum interval between requests in milliseconds.
   * Default: 250ms.
   */
  minIntervalMs?: number;
  /**
   * Request timeout in milliseconds.
   * Default: 4000ms.
   */
  timeoutMs?: number;
}

interface GammaMarketResponse {
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: number | string;
  liquidity?: number | string;
  clobTokenIds?: string;
  outcomes?: string;
  outcomePrices?: string;
}

const DEFAULT_BASE_URL = "https://gamma-api.polymarket.com";

/**
 * Returns a fallback 50/50 market snapshot used when external API is unavailable.
 */
export function createDegradedMarketData(): MarketData {
  return {
    impliedProbA: 0.5,
    impliedProbB: 0.5,
    volume: 0,
    status: "PAUSED",
  };
}

/**
 * Polymarket API client with built-in rate-limiting and graceful degradation.
 */
export class PolymarketClient {
  private readonly fetchImpl: HttpFetch;

  private readonly baseUrl: string;

  private readonly minIntervalMs: number;

  private readonly timeoutMs: number;

  private lastRequestAt = 0;

  constructor(fetchImpl: HttpFetch, options: PolymarketClientOptions = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  /**
   * Fetches and normalizes a Polymarket market.
   * On failures, returns a degraded but valid market state instead of throwing.
   */
  async fetchMarketData(polymarketMarketId: string): Promise<MarketData> {
    await this.waitForRateLimit();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Polymarket request timeout")), this.timeoutMs);
    });

    try {
      const requestPromise = this.fetchImpl(
        `${this.baseUrl}/markets/${encodeURIComponent(polymarketMarketId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
      );

      const response = await Promise.race([requestPromise, timeoutPromise]);
      if (!response.ok) {
        return createDegradedMarketData();
      }

      const payload = (await response.json()) as GammaMarketResponse;
      return normalizeGammaPayload(payload);
    } catch {
      return createDegradedMarketData();
    }
  }

  /**
   * Creates a persisted market snapshot object for a match mapping.
   */
  async createMarketSnapshot(marketMapping: MarketMapping): Promise<MarketSnapshot> {
    const data = await this.fetchMarketData(marketMapping.polymarketMarketId);
    return {
      id: `ms_${marketMapping.id}_${Date.now()}`,
      marketMappingId: marketMapping.id,
      impliedProbA: data.impliedProbA,
      impliedProbB: data.impliedProbB,
      volume: data.volume,
      capturedAt: new Date(),
    };
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    const waitMs = Math.max(0, this.minIntervalMs - elapsed);

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.lastRequestAt = Date.now();
  }
}

/**
 * Normalizes Polymarket gamma payload into internal market data shape.
 */
export function normalizeGammaPayload(payload: GammaMarketResponse): MarketData {
  const fallback = createDegradedMarketData();

  const parsedPrices = parseNumberArray(payload.outcomePrices);
  const probA = clamp01(parsedPrices[0] ?? fallback.impliedProbA);
  const probBRaw = parsedPrices[1] ?? 1 - probA;
  const probB = clamp01(probBRaw);

  const volume = toFiniteNumber(payload.volume) ?? toFiniteNumber(payload.liquidity) ?? 0;

  const status: MarketMapping["status"] = payload.closed || payload.archived
    ? "RESOLVED"
    : payload.active === false
      ? "PAUSED"
      : "ACTIVE";

  const normalized = normalizeProbabilities(probA, probB);

  return {
    impliedProbA: normalized.a,
    impliedProbB: normalized.b,
    volume: Math.max(0, volume),
    status,
  };
}

function parseNumberArray(raw: unknown): number[] {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => toFiniteNumber(value))
      .filter((value): value is number => typeof value === "number");
  } catch {
    return [];
  }
}

function toFiniteNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const n = Number.parseFloat(input);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeProbabilities(a: number, b: number): { a: number; b: number } {
  const sum = a + b;
  if (sum <= 0) {
    return { a: 0.5, b: 0.5 };
  }

  return {
    a: clamp01(a / sum),
    b: clamp01(b / sum),
  };
}
