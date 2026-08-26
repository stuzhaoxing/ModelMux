import styles from "./CompetitionScreen.module.css";

export default function CompetitionScreenBackdrop() {
  return (
    <div className={styles.fieldBackdrop} aria-hidden="true">
      <div className={styles.fieldGrid} />
    </div>
  );
}
