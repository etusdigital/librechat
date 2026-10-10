import type { RouteObject } from 'react-router-dom';

export const DesignHome = () =>
  import('./home/DesignHomePage').then((m) => ({ Component: m.default }));

export const DesignProject = () =>
  import('./workspace/DesignWorkspacePage').then((m) => ({ Component: m.default }));

export const DesignSystems = () =>
  import('./systems/DesignSystemsPage').then((m) => ({ Component: m.default }));

export const DesignSystemDetail = () =>
  import('./systems/DesignSystemDetailPage').then((m) => ({ Component: m.default }));

export const designRoutes: RouteObject[] = [
  { path: 'design', lazy: DesignHome },
  { path: 'design/systems', lazy: DesignSystems },
  { path: 'design/systems/:systemId', lazy: DesignSystemDetail },
  { path: 'design/:projectId', lazy: DesignProject },
];
