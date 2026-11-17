const MAX_TITLE_LENGTH = 80;

export function toChatTitle(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) return "Prescription image";
  if (singleLine.length <= MAX_TITLE_LENGTH) return singleLine;
  return `${singleLine.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}
