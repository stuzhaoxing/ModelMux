import type { Metadata } from "next";

import {
  COMPETITION_NAME,
  COMPETITION_SCREEN_NAME,
  COMPETITION_TRACK_NAME,
} from "@/lib/competition/screen-branding";
import { getCompetitionScreenSnapshot } from "@/lib/competition/screen";
import CompetitionScreen from "@/src/competition/CompetitionScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${COMPETITION_SCREEN_NAME} | ${COMPETITION_TRACK_NAME} | ${COMPETITION_NAME}`,
  robots: { index: false, follow: false },
};

export default async function CompetitionScreenPage() {
  let snapshot = null;
  try {
    snapshot = await getCompetitionScreenSnapshot();
  } catch (error) {
    console.error("[competition] 大屏首屏数据读取失败", error);
  }
  return <CompetitionScreen initialSnapshot={snapshot} />;
}
