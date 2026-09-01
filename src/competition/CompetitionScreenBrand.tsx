import Image from "next/image";

import {
  COMPETITION_DISPLAY_NAME,
  COMPETITION_NAME,
  COMPETITION_TRACK_NAME,
} from "@/lib/competition/screen-branding";

import styles from "./CompetitionScreen.module.css";

interface CompetitionScreenBrandProps {
  time?: string;
  countdownLabel?: string;
  countdownValue?: string;
  stageLabel?: string;
  stageDetail?: string;
}

export default function CompetitionScreenBrand({
  time,
  countdownLabel,
  countdownValue,
  stageLabel,
  stageDetail,
}: CompetitionScreenBrandProps) {
  const showCountdown = Boolean(countdownLabel && countdownValue);

  return (
    <header className={styles.eventMasthead} data-countdown={showCountdown}>
      <Image
        alt=""
        aria-hidden
        className={styles.eventHeaderSky}
        height={320}
        preload
        src="/screen/competition-header-sky.webp"
        width={2560}
      />

      <div className={styles.eventTitles}>
        <h1 aria-label={COMPETITION_NAME}>{COMPETITION_DISPLAY_NAME}</h1>
        <div className={styles.eventSubtitleLine}>
          <p>{COMPETITION_TRACK_NAME}</p>
          {stageLabel && (
            <span className={styles.eventStage}>
              <i />
              <strong>{stageLabel}</strong>
              {stageDetail && <small>{stageDetail}</small>}
            </span>
          )}
        </div>
      </div>

      {showCountdown ? (
        <div className={styles.eventCountdown}>
          <div className={styles.eventCountdownMeta}>
            <span>{countdownLabel}</span>
            {time && <small>北京时间 {time}</small>}
          </div>
          <strong>{countdownValue}</strong>
        </div>
      ) : time && (
        <div className={styles.currentTime}>
          <span>北京时间</span>
          <strong>{time}</strong>
        </div>
      )}
    </header>
  );
}
