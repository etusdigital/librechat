export const CHAT_WIDTH_MIN = 320;
export const CHAT_WIDTH_MAX = 560;
export const CHAT_WIDTH_DEFAULT = 440;
export const CHAT_WIDTH_STEP = 16;
export const CHAT_WIDTH_STORAGE_KEY = 'etus-design:chat-width';

export function clampChatWidth(width: number) {
  if (!Number.isFinite(width)) {
    return CHAT_WIDTH_DEFAULT;
  }
  return Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(width)));
}

export function readChatWidth() {
  try {
    const stored = window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY);
    return stored ? clampChatWidth(Number(stored)) : CHAT_WIDTH_DEFAULT;
  } catch {
    return CHAT_WIDTH_DEFAULT;
  }
}

export function storeChatWidth(width: number) {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    return;
  }
}
