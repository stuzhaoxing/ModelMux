export function answerSaveCoversCurrentRevision(
  requestRevision: number,
  currentRevision: number,
): boolean {
  return requestRevision === currentRevision;
}
