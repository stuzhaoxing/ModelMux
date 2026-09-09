export interface CompetitionArchiveSummary {
  id: string;
  reason: "reset" | "before_restore";
  actorName: string;
  answerCount: number;
  submittedCount: number;
  contestantCount: number;
  createdAt: string;
}
