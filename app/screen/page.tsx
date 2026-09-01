import type { Metadata } from "next";
import { cookies } from "next/headers";

import {
  COMPETITION_NAME,
  COMPETITION_SCREEN_NAME,
  COMPETITION_TRACK_NAME,
} from "@/lib/competition/screen-branding";
import {
  screenAuthConfigured,
  screenSessionCookieName,
  verifyScreenSessionToken,
} from "@/lib/competition/screen-auth";
import { getCompetitionScreenSnapshot } from "@/lib/competition/screen";
import {
  competitionScreenMockEnabled,
  getCompetitionScreenMockSnapshot,
  startCompetitionScreenMock,
} from "@/lib/competition/screen-mock";
import CompetitionScreen from "@/src/competition/CompetitionScreen";
import CompetitionScreenLogin from "@/src/competition/CompetitionScreenLogin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${COMPETITION_SCREEN_NAME} | ${COMPETITION_TRACK_NAME} | ${COMPETITION_NAME}`,
  robots: { index: false, follow: false },
};

export default async function CompetitionScreenPage({
  searchParams,
}: {
  searchParams: Promise<{
    mock?: string | string[];
    mockToken?: string | string[];
    noticePreview?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const mockMode = competitionScreenMockEnabled()
    && (query.mock === "1" || query.mockToken === "1");
  const noticePreview = competitionScreenMockEnabled()
    && query.noticePreview === "1";
  const token = (await cookies()).get(screenSessionCookieName)?.value;
  if (!verifyScreenSessionToken(token)) {
    return <CompetitionScreenLogin configured={screenAuthConfigured()} />;
  }

  let snapshot = null;
  let mockStartedAt: number | null = null;
  try {
    if (mockMode) startCompetitionScreenMock();
    snapshot = mockMode
      ? await getCompetitionScreenMockSnapshot()
      : await getCompetitionScreenSnapshot();
    mockStartedAt = snapshot.simulation ? Date.parse(snapshot.simulation.startedAt) : null;
  } catch (error) {
    console.error("[competition] 大屏首屏数据读取失败", error);
  }
  return <CompetitionScreen
    initialSnapshot={snapshot}
    key={mockMode ? `mock-${mockStartedAt}` : "live"}
    mockMode={mockMode}
    mockStartedAt={mockStartedAt}
    noticePreview={noticePreview}
  />;
}
