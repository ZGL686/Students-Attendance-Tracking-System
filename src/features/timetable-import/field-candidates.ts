export type FieldCandidate = {
  text: string;
  confidence: number;
  anchored: boolean;
  family: 'color-card' | 'contrast-card' | 'color-room' | 'contrast-room';
};

/** Scales of the same pixels are correlated; count distinct region/contrast evidence. */
export function selectRoomCandidate(candidates: FieldCandidate[]): FieldCandidate | undefined {
  const reliable = candidates.filter((candidate) => candidate.text && candidate.confidence >= 75);
  const families = (candidate: FieldCandidate) =>
    new Set(reliable.filter((other) => other.text === candidate.text).map((other) => other.family));
  return reliable.sort(
    (a, b) =>
      Number(b.anchored) - Number(a.anchored) ||
      families(b).size - families(a).size ||
      b.confidence - a.confidence,
  )[0];
}
