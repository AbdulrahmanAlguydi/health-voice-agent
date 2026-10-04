const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Returns the last complete English or Arabic question sentence from approved text. */
export function extractLastQuestion(text: string): string | undefined {
  const segments: string[] = [];

  for (const { segment } of sentenceSegmenter.segment(text)) {
    const trimmedSegment = segment.trim();
    const previousIndex = segments.length - 1;
    const previousSegment = segments[previousIndex];

    // ICU may split after doctor-title abbreviations, mistaking their period for
    // a sentence boundary. Rejoin the title with the doctor's name before
    // looking for the last question.
    if (previousSegment && /(?:\bDr\.|د\.)$/iu.test(previousSegment)) {
      segments[previousIndex] = `${previousSegment} ${trimmedSegment}`;
    } else {
      segments.push(trimmedSegment);
    }
  }

  return segments.reverse().find((segment) => /[?؟]$/.test(segment));
}
