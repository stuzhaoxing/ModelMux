import Image from "next/image";

import {
  COMPETITION_DISPLAY_NAME,
  COMPETITION_NAME,
  COMPETITION_TRACK_NAME,
} from "@/lib/competition/screen-branding";

import styles from "./CompetitionScreen.module.css";

export default function CompetitionScreenBrand({ time }: { time?: string }) {
  return (
    <header className={styles.eventMasthead}>
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
        <p>{COMPETITION_TRACK_NAME}</p>
      </div>

      {time && (
        <div className={styles.currentTime}>
          <span>北京时间</span>
          <strong>{time}</strong>
        </div>
      )}
    </header>
  );
}
