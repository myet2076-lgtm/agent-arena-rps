import type { MarketMapping, MarketSnapshot } from "@/types";
import { PolymarketClient } from "./polymarket-client";

/**
 * Outbound click analytics record.
 */
export interface OutboundClick {
  id: string;
  matchId: string;
  viewerId: string;
  source: string;
  targetUrl: string;
  userAgent?: string;
  referrer?: string;
  clickedAt: Date;
}

/**
 * Additional parameters captured on outbound clicks.
 */
export interface OutboundClickParams {
  source: string;
  userAgent?: string;
  referrer?: string;
}

/**
 * Repository abstraction for market mapping / snapshot persistence.
 */
export interface MarketRepository {
  getMappingByMatchId(matchId: string): Promise<MarketMapping | null>;
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>;
  saveOutboundClick(click: OutboundClick): Promise<void>;
}

/**
 * In-memory market repository for tests and local dev.
 */
export class InMemoryMarketRepository implements MarketRepository {
  private readonly mappings = new Map<string, MarketMapping>();

  public readonly snapshots: MarketSnapshot[] = [];

  public readonly outboundClicks: OutboundClick[] = [];

  constructor(seedMappings: MarketMapping[] = []) {
    for (const mapping of seedMappings) {
      this.mappings.set(mapping.matchId, mapping);
    }
  }

  async getMappingByMatchId(matchId: string): Promise<MarketMapping | null> {
    return this.mappings.get(matchId) ?? null;
  }

  async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    this.snapshots.push(snapshot);
  }

  async saveOutboundClick(click: OutboundClick): Promise<void> {
    this.outboundClicks.push(click);
  }
}

/**
 * Service combining mapping lookup, market sync, and outbound attribution.
 */
export class MarketService {
  constructor(
    private readonly repository: MarketRepository,
    private readonly polymarketClient: Pick<PolymarketClient, "createMarketSnapshot">,
    private readonly baseAttributionUrl = "https://agent-arena.example/out",
  ) {}

  /**
   * Returns market mapping for a match.
   * Gracefully degrades to null when no mapping is configured.
   */
  async getMarketForMatch(matchId: string): Promise<MarketMapping | null> {
    return this.repository.getMappingByMatchId(matchId);
  }

  /**
   * Synchronizes a fresh market snapshot for a match.
   * If market is unavailable/unmapped, returns null instead of throwing.
   */
  async syncMarketData(matchId: string): Promise<MarketSnapshot | null> {
    const mapping = await this.getMarketForMatch(matchId);
    if (!mapping) {
      return null;
    }

    try {
      const snapshot = await this.polymarketClient.createMarketSnapshot(mapping);
      await this.repository.saveSnapshot(snapshot);
      return snapshot;
    } catch {
      return null;
    }
  }

  /**
   * Generates an attributed outbound URL used for Polymarket redirects.
   */
  generateOutboundUrl(marketMapping: MarketMapping, viewerId: string, source: string): string {
    const destination = new URL(marketMapping.polymarketUrl);
    destination.searchParams.set("utm_source", source);
    destination.searchParams.set("utm_medium", "agent_arena");
    destination.searchParams.set("utm_campaign", `match_${marketMapping.matchId}`);
    destination.searchParams.set("viewer_id", viewerId);

    const redirect = new URL(this.baseAttributionUrl);
    redirect.searchParams.set("to", destination.toString());
    redirect.searchParams.set("match_id", marketMapping.matchId);
    redirect.searchParams.set("market_mapping_id", marketMapping.id);

    return redirect.toString();
  }

  /**
   * Records outbound click attribution for analytics.
   */
  async recordOutboundClick(
    matchId: string,
    viewerId: string,
    params: OutboundClickParams,
  ): Promise<void> {
    const mapping = await this.getMarketForMatch(matchId);
    if (!mapping) {
      return;
    }

    const targetUrl = this.generateOutboundUrl(mapping, viewerId, params.source);
    await this.repository.saveOutboundClick({
      id: `oc_${matchId}_${viewerId}_${Date.now()}`,
      matchId,
      viewerId,
      source: params.source,
      targetUrl,
      userAgent: params.userAgent,
      referrer: params.referrer,
      clickedAt: new Date(),
    });
  }
}
