export const NEXT_STEPS_COUNT = 3;

const HEADING =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*pr[óo]ximos\s+passos\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,2}[.)])\s+(.+?)\s*$/;

function cleanItem(raw: string): string {
  return raw
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__(.+)__$/, '$1')
    .replace(/^["“'](.+)["”']$/, '$1')
    .trim();
}

export function parseNextSteps(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let headingIndex = -1;
  lines.forEach((line, index) => {
    if (HEADING.test(line)) {
      headingIndex = index;
    }
  });
  if (headingIndex === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    const match = LIST_ITEM.exec(line);
    if (!match) {
      break;
    }
    const item = cleanItem(match[1]);
    if (item === '') {
      return [];
    }
    items.push(item);
  }
  return items.length === NEXT_STEPS_COUNT ? items : [];
}
