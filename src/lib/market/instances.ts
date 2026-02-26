import { db } from "@/lib/server/in-memory-db";
import type { Vote } from "@/types";
import type { VoteRepository } from "./vote-service";
import { VoteService } from "./vote-service";

const voteRepository: VoteRepository = {
  async findByViewerMatchRound(viewerId: string, matchId: string, roundNo: number | null) {
    return (
      db
        .getVotesForMatch(matchId)
        .find((vote) => vote.viewerId === viewerId && vote.matchId === matchId && vote.roundNo === roundNo) ??
      null
    );
  },
  async insertVote(vote: Vote) {
    db.addVote(vote.matchId, vote);
  },
  async listVotesByMatch(matchId: string) {
    return db.getVotesForMatch(matchId);
  },
  async listVotesByViewer(viewerId: string, matchId?: string) {
    if (!matchId) {
      return [];
    }

    return db.getVotesForMatch(matchId).filter((vote) => vote.viewerId === viewerId);
  },
};

export const voteService = new VoteService(voteRepository);
