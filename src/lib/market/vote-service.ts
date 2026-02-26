import type { Vote } from "@/types";

/**
 * Storage abstraction for votes.
 */
export interface VoteRepository {
  findByViewerMatchRound(
    viewerId: string,
    matchId: string,
    roundNo: number | null,
  ): Promise<Vote | null>;
  insertVote(vote: Vote): Promise<void>;
  listVotesByMatch(matchId: string): Promise<Vote[]>;
  listVotesByViewer(viewerId: string, matchId?: string): Promise<Vote[]>;
}

/**
 * In-memory vote repository used by tests and local dev.
 */
export class InMemoryVoteRepository implements VoteRepository {
  public readonly votes: Vote[] = [];

  async findByViewerMatchRound(
    viewerId: string,
    matchId: string,
    roundNo: number | null,
  ): Promise<Vote | null> {
    return (
      this.votes.find(
        (vote) =>
          vote.viewerId === viewerId &&
          vote.matchId === matchId &&
          vote.roundNo === roundNo,
      ) ?? null
    );
  }

  async insertVote(vote: Vote): Promise<void> {
    this.votes.push(vote);
  }

  async listVotesByMatch(matchId: string): Promise<Vote[]> {
    return this.votes.filter((vote) => vote.matchId === matchId);
  }

  async listVotesByViewer(viewerId: string, matchId?: string): Promise<Vote[]> {
    return this.votes.filter(
      (vote) => vote.viewerId === viewerId && (!matchId || vote.matchId === matchId),
    );
  }
}

/**
 * Error thrown when duplicate vote is attempted for same viewer/match/round tuple.
 */
export class DuplicateVoteError extends Error {
  constructor(message = "Duplicate vote is not allowed") {
    super(message);
    this.name = "DuplicateVoteError";
  }
}

/**
 * Viewer vote service enforcing one vote per viewer per round (or pre-match).
 */
export class VoteService {
  constructor(private readonly repository: VoteRepository) {}

  /**
   * Cast a viewer vote for a match and optional round.
   * Enforces duplicate prevention on (viewerId, matchId, roundNo).
   */
  async castVote(
    matchId: string,
    viewerId: string,
    side: Vote["side"],
    roundNo: number | null = null,
  ): Promise<Vote> {
    const existing = await this.repository.findByViewerMatchRound(viewerId, matchId, roundNo);
    if (existing) {
      throw new DuplicateVoteError(
        `Viewer ${viewerId} already voted for match ${matchId} round ${String(roundNo)}`,
      );
    }

    const vote: Vote = {
      id: `vote_${matchId}_${viewerId}_${roundNo ?? "prematch"}_${Date.now()}`,
      matchId,
      viewerId,
      side,
      roundNo,
      createdAt: new Date(),
    };

    await this.repository.insertVote(vote);
    return vote;
  }

  /**
   * Returns current tally for a match.
   */
  async getVoteTally(matchId: string): Promise<{ a: number; b: number }> {
    const votes = await this.repository.listVotesByMatch(matchId);
    return votes.reduce(
      (acc, vote) => {
        if (vote.side === "A") {
          acc.a += 1;
        } else {
          acc.b += 1;
        }
        return acc;
      },
      { a: 0, b: 0 },
    );
  }

  /**
   * Returns voting history for a viewer, optionally scoped to one match.
   */
  async getViewerVoteHistory(viewerId: string, matchId?: string): Promise<Vote[]> {
    const votes = await this.repository.listVotesByViewer(viewerId, matchId);
    return [...votes].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }
}
