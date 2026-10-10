export const PROJECT_LINK_LABEL = 'Projeto Etus Design';

export function projectLinkLine(projectId: string): string {
  return `[${PROJECT_LINK_LABEL}]: ${projectId}`;
}

export function projectFirstMessage(projectId: string, text: string): string {
  return `${projectLinkLine(projectId)}\n\n${text.trim()}`;
}

export function draftInsertion(draft: string, text: string): string {
  if (draft.trim() === '') {
    return text;
  }
  if (draft.endsWith('\n\n')) {
    return text;
  }
  return draft.endsWith('\n') ? `\n${text}` : `\n\n${text}`;
}
