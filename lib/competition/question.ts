export const questionTitleMaxLength = 50;

export function questionTitleLength(title: string): number {
  return Array.from(title).length;
}

export function questionTitleIsWithinLimit(title: string): boolean {
  return questionTitleLength(title) <= questionTitleMaxLength;
}
