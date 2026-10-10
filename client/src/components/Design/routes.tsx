export const loadDesignProject = () =>
  import('./spike/DesignChatSpikePage').then((m) => ({ Component: m.default }));
