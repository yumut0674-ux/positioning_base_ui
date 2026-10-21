const TAG_COLORS = ["#5de4c7", "#f6c760", "#7aa2f7", "#dc7b8b", "#b892ff"];
export function colorForTag(tagId: string): string {
  return TAG_COLORS[[...tagId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % TAG_COLORS.length];
}
