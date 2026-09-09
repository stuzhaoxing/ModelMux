import { CircleStop, FlaskConical, LoaderCircle, Trophy } from "lucide-react";

import { competitionIsTesting } from "@/lib/competition/control";
import type { CompetitionControl } from "@/lib/competition/types";

export function JudgeCompetitionStatus({ competition }: { competition: CompetitionControl | null }) {
  const state = !competition ? "loading" : competitionIsTesting(competition) ? "not_started" : competition.state;
  const { label, tone, Icon } = {
    loading: { label: "比赛状态同步中", tone: "ended", Icon: LoaderCircle },
    not_started: { label: "测试", tone: "test", Icon: FlaskConical },
    running: { label: "比赛中", tone: "competition", Icon: Trophy },
    ended: { label: "比赛已结束", tone: "ended", Icon: CircleStop },
  }[state];

  return (
    <span className={`operation-mode-pill ${tone}`} role="status" aria-label="比赛状态">
      <Icon size={14} />
      {label}
    </span>
  );
}
