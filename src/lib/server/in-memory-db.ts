import {
  type AgentRecord,
  type AgentStatus,
  type CommitRecord,
  type EloRating,
  type GameEvent,
  type MarketSnapshot,
  type Match,
  MatchStatus,
  type QualificationMatch,
  type QueueEntry,
  type RevealRecord,
  type Round,
  RULES,
  type ShareCard,
  type ShareEvent,
  type ViewerRanking,
  type Vote,
} from "@/types";
import { verifyCommit } from "@/lib/fairness/commit-reveal";
import { randomUUID } from "node:crypto";

const now = () => new Date();

// ─── New Collections (PRD §3) ───────────────────────────
const agents = new Map<string, AgentRecord>();
const agentsByKeyHash = new Map<string, AgentRecord>();
const agentsByName = new Map<string, AgentRecord>();
const queueEntries = new Map<string, QueueEntry>();
const qualificationMatches = new Map<string, QualificationMatch>();

const matches = new Map<string, Match>();
const roundsByMatch = new Map<string, Round[]>();
const commits = new Map<string, CommitRecord>();
const reveals = new Map<string, RevealRecord>();
const marketByMatch = new Map<string, MarketSnapshot>();
const votesByMatch = new Map<string, Vote[]>();
const shareCardByMatch = new Map<string, ShareCard>();
const shareCardByToken = new Map<string, ShareCard>();
const shareEventsByCard = new Map<string, ShareEvent[]>();
const viewerRankings = new Map<string, ViewerRanking>();
const eloRatingsByAgent = new Map<string, EloRating[]>();
const usedRevealNoncesByMatch = new Map<string, Set<string>>();
const eventsByMatch = new Map<string, Array<{ seq: number; event: GameEvent }>>();

let eventSeq = 0;

function commitKey(matchId: string, roundNo: number, agentId: string): string {
  return `${matchId}:${roundNo}:${agentId}`;
}

function revealKey(matchId: string, roundNo: number, agentId: string): string {
  return `${matchId}:${roundNo}:${agentId}`;
}

const MAX_EVENT_BUFFER = 50;

function pushEvent(matchId: string, event: GameEvent): void {
  const list = eventsByMatch.get(matchId) ?? [];
  list.push({ seq: ++eventSeq, event });
  // Enforce max buffer size (PRD contract)
  if (list.length > MAX_EVENT_BUFFER) {
    list.splice(0, list.length - MAX_EVENT_BUFFER);
  }
  eventsByMatch.set(matchId, list);
}

function seedMatch(matchId: string): Match {
  const started = now();
  return {
    id: matchId,
    seasonId: "season-1",
    agentA: "agent-a",
    agentB: "agent-b",
    status: MatchStatus.RUNNING,
    format: "BO7",
    scoreA: 0,
    scoreB: 0,
    winsA: 0,
    winsB: 0,
    currentRound: 0,
    maxRounds: RULES.MAX_ROUNDS,
    winnerId: null,
    startedAt: started,
    finishedAt: null,
    createdAt: started,
    readyA: false,
    readyB: false,
    readyDeadline: null,
    currentPhase: "COMMIT" as Match["currentPhase"],
    phaseDeadline: null,
    eloChangeA: null,
    eloChangeB: null,
    eloUpdatedAt: null,
  };
}

function initDevData(): void {
  const match = seedMatch("match-1");
  matches.set(match.id, match);
  roundsByMatch.set(match.id, []);
  votesByMatch.set(match.id, []);
  marketByMatch.set(match.id, {
    id: randomUUID(),
    marketMappingId: `mapping-${match.id}`,
    impliedProbA: 0.5,
    impliedProbB: 0.5,
    volume: 0,
    capturedAt: now(),
  });

  const devShareCard: ShareCard = {
    id: randomUUID(),
    matchId: match.id,
    imageUrl: "/og/match-result.png",
    highlightRounds: [],
    shareToken: "dev-share-match-1",
    createdAt: now(),
  };
  shareCardByMatch.set(match.id, devShareCard);
  shareCardByToken.set(devShareCard.shareToken, devShareCard);
}

export const db = {
  initDevData,
  reset(): void {
    matches.clear();
    roundsByMatch.clear();
    commits.clear();
    reveals.clear();
    marketByMatch.clear();
    votesByMatch.clear();
    shareCardByMatch.clear();
    shareCardByToken.clear();
    shareEventsByCard.clear();
    viewerRankings.clear();
    eloRatingsByAgent.clear();
    usedRevealNoncesByMatch.clear();
    eventsByMatch.clear();
    agents.clear();
    agentsByKeyHash.clear();
    agentsByName.clear();
    queueEntries.clear();
    qualificationMatches.clear();
    eventSeq = 0;
    initDevData();
  },
  listMatches(): Match[] {
    return Array.from(matches.values());
  },
  getMatch(matchId: string): Match | null {
    return matches.get(matchId) ?? null;
  },
  updateMatch(match: Match): Match {
    matches.set(match.id, match);
    return match;
  },
  getRounds(matchId: string): Round[] {
    return [...(roundsByMatch.get(matchId) ?? [])].sort((a, b) => a.roundNo - b.roundNo);
  },
  addRound(round: Round): Round {
    const rounds = roundsByMatch.get(round.matchId) ?? [];
    const next = rounds.filter((r) => r.roundNo !== round.roundNo);
    next.push(round);
    roundsByMatch.set(round.matchId, next.sort((a, b) => a.roundNo - b.roundNo));
    return round;
  },
  getRound(matchId: string, roundNo: number): Round | null {
    return (roundsByMatch.get(matchId) ?? []).find((r) => r.roundNo === roundNo) ?? null;
  },
  getMarket(matchId: string): MarketSnapshot | null {
    return marketByMatch.get(matchId) ?? null;
  },
  getVotes(matchId: string): Vote[] {
    return [...(votesByMatch.get(matchId) ?? [])];
  },
  getVotesForMatch(matchId: string): Vote[] {
    return [...(votesByMatch.get(matchId) ?? [])];
  },
  addEloRating(rating: EloRating): EloRating {
    const current = eloRatingsByAgent.get(rating.agentId) ?? [];
    current.push(rating);
    eloRatingsByAgent.set(rating.agentId, current);
    return rating;
  },
  getCurrentEloRating(agentId: string): EloRating | null {
    const ratings = eloRatingsByAgent.get(agentId) ?? [];
    if (ratings.length === 0) return null;

    return ratings.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  },
  getEloMatchCount(agentId: string): number {
    return (eloRatingsByAgent.get(agentId) ?? []).length;
  },
  listEloRatingsBySeason(seasonId: string, _period?: "weekly" | "seasonal" | "all"): EloRating[] {
    const all = [...eloRatingsByAgent.values()].flat();
    return all.filter((rating) => {
      const match = matches.get(rating.matchId);
      return match?.seasonId === seasonId;
    });
  },
  upsertCommit(matchId: string, roundNo: number, agentId: string, commitHash: string): CommitRecord {
    const record: CommitRecord = {
      id: randomUUID(),
      matchId,
      roundNo,
      agentId,
      commitHash,
      committedAt: now(),
      expiresAt: new Date(Date.now() + RULES.COMMIT_TIMEOUT_MS),
      prediction: null,
    };
    commits.set(commitKey(matchId, roundNo, agentId), record);

    pushEvent(matchId, { type: "ROUND_COMMIT", matchId, roundNo, agentId });
    return record;
  },
  getCommit(matchId: string, roundNo: number, agentId: string): CommitRecord | null {
    return commits.get(commitKey(matchId, roundNo, agentId)) ?? null;
  },
  upsertReveal(matchId: string, roundNo: number, agentId: string, move: Round["moveA"], salt: string): RevealRecord {
    const rec: RevealRecord = {
      id: randomUUID(),
      matchId,
      roundNo,
      agentId,
      move: move!,
      salt,
      verified: false,
      revealedAt: now(),
    };
    reveals.set(revealKey(matchId, roundNo, agentId), rec);
    return rec;
  },
  getReveal(matchId: string, roundNo: number, agentId: string): RevealRecord | null {
    return reveals.get(revealKey(matchId, roundNo, agentId)) ?? null;
  },
  /** Directly mark a reveal as verified (called after hash check in reveal route) */
  verifyRevealDirect(matchId: string, roundNo: number, agentId: string): void {
    const reveal = reveals.get(revealKey(matchId, roundNo, agentId));
    if (reveal) reveal.verified = true;
  },
  verifyReveal(matchId: string, roundNo: number, agentId: string): boolean {
    const reveal = reveals.get(revealKey(matchId, roundNo, agentId));
    const commit = commits.get(commitKey(matchId, roundNo, agentId));
    if (!reveal || !commit) return false;

    reveal.verified = verifyCommit(commit.commitHash, reveal.move, reveal.salt);
    return reveal.verified;
  },
  getOrCreateRevealNonceSet(matchId: string): Set<string> {
    const set = usedRevealNoncesByMatch.get(matchId) ?? new Set<string>();
    usedRevealNoncesByMatch.set(matchId, set);
    return set;
  },
  appendEvents(matchId: string, events: GameEvent[]): void {
    for (const event of events) pushEvent(matchId, event);
  },
  getEventsSince(matchId: string, sinceSeq: number): Array<{ seq: number; event: GameEvent }> {
    return (eventsByMatch.get(matchId) ?? []).filter((entry) => entry.seq > sinceSeq);
  },
  getOldestSeq(matchId: string): number {
    const list = eventsByMatch.get(matchId) ?? [];
    return list.length > 0 ? list[0].seq : 0;
  },
  addVote(matchId: string, vote: Vote): Vote {
    const votes = votesByMatch.get(matchId) ?? [];
    const withoutCurrent = votes.filter((v) => !(v.viewerId === vote.viewerId && v.roundNo === vote.roundNo));
    withoutCurrent.push(vote);
    votesByMatch.set(matchId, withoutCurrent);

    const tally = {
      votesA: withoutCurrent.filter((v) => v.side === "A").length,
      votesB: withoutCurrent.filter((v) => v.side === "B").length,
    };
    pushEvent(matchId, { type: "VOTE_UPDATE", matchId, ...tally });
    return vote;
  },
  getVoteTally(matchId: string): { a: number; b: number } {
    const votes = votesByMatch.get(matchId) ?? [];
    return {
      a: votes.filter((v) => v.side === "A").length,
      b: votes.filter((v) => v.side === "B").length,
    };
  },
  setShareCard(matchId: string, card: ShareCard): ShareCard {
    shareCardByMatch.set(matchId, card);
    shareCardByToken.set(card.shareToken, card);
    return card;
  },
  getShareCard(matchId: string): ShareCard | null {
    return shareCardByMatch.get(matchId) ?? null;
  },
  getShareCardByToken(token: string): ShareCard | null {
    return shareCardByToken.get(token) ?? null;
  },
  addShareEvent(event: ShareEvent): ShareEvent {
    const events = shareEventsByCard.get(event.shareCardId) ?? [];
    events.push(event);
    shareEventsByCard.set(event.shareCardId, events);
    return event;
  },
  getViewerRankings(period: "weekly" | "season", seasonId?: string): ViewerRanking[] {
    const source = [...viewerRankings.values()].filter((ranking) => {
      if (!seasonId) return true;
      return ranking.seasonId === seasonId;
    });
    if (source.length > 0) return source;

    return [
      {
        id: randomUUID(),
        viewerId: "viewer-1",
        seasonId: period === "season" ? (seasonId ?? "season-1") : "week-current",
        totalVotes: 10,
        correctVotes: 7,
        hitRate: 0.7,
        currentStreak: 2,
        bestStreak: 4,
        badges: ["reader"],
        votedMatchIds: ["match-1"],
        updatedAt: now(),
      },
    ];
  },
  getViewerRanking(viewerId: string, seasonId: string): ViewerRanking | null {
    return viewerRankings.get(`${seasonId}:${viewerId}`) ?? null;
  },
  upsertViewerRanking(ranking: ViewerRanking): ViewerRanking {
    viewerRankings.set(`${ranking.seasonId}:${ranking.viewerId}`, ranking);
    return ranking;
  },
  // ─── Agent CRUD ──────────────────────────────────────
  createAgent(agent: AgentRecord): AgentRecord {
    agents.set(agent.id, agent);
    agentsByKeyHash.set(agent.keyHash, agent);
    agentsByName.set(agent.name.toLowerCase(), agent);
    return agent;
  },
  getAgent(id: string): AgentRecord | null {
    return agents.get(id) ?? null;
  },
  getAgentByKeyHash(keyHash: string): AgentRecord | null {
    return agentsByKeyHash.get(keyHash) ?? null;
  },
  getAgentByName(name: string): AgentRecord | null {
    return agentsByName.get(name.toLowerCase()) ?? null;
  },
  updateAgent(agent: AgentRecord): AgentRecord {
    agents.set(agent.id, agent);
    agentsByKeyHash.set(agent.keyHash, agent);
    agentsByName.set(agent.name.toLowerCase(), agent);
    return agent;
  },
  listAgents(): AgentRecord[] {
    return [...agents.values()];
  },
  agentCount(): number {
    return agents.size;
  },

  // ─── Queue CRUD ─────────────────────────────────────
  createQueueEntry(entry: QueueEntry): QueueEntry {
    queueEntries.set(entry.id, entry);
    return entry;
  },
  getQueueEntry(id: string): QueueEntry | null {
    return queueEntries.get(id) ?? null;
  },
  getQueueEntryByAgent(agentId: string): QueueEntry | null {
    for (const entry of queueEntries.values()) {
      if (entry.agentId === agentId && entry.status === "WAITING") return entry;
    }
    return null;
  },
  getActiveQueueEntryByAgent(agentId: string): QueueEntry | null {
    for (const entry of queueEntries.values()) {
      if (entry.agentId === agentId && (entry.status === "WAITING" || entry.status === "MATCHED")) return entry;
    }
    return null;
  },
  updateQueueEntry(entry: QueueEntry): QueueEntry {
    queueEntries.set(entry.id, entry);
    return entry;
  },
  listQueueEntries(status?: QueueEntry["status"]): QueueEntry[] {
    const all = [...queueEntries.values()];
    if (!status) return all;
    return all.filter((e) => e.status === status).sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  },

  // ─── Qualification CRUD ─────────────────────────────
  createQualificationMatch(match: QualificationMatch): QualificationMatch {
    qualificationMatches.set(match.id, match);
    return match;
  },
  getQualificationMatch(id: string): QualificationMatch | null {
    return qualificationMatches.get(id) ?? null;
  },
  updateQualificationMatch(match: QualificationMatch): QualificationMatch {
    qualificationMatches.set(match.id, match);
    return match;
  },
  listQualificationMatchesByAgent(agentId: string): QualificationMatch[] {
    return [...qualificationMatches.values()].filter((m) => m.agentId === agentId);
  },
};

initDevData();
