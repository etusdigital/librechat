import {
  DesignHome,
  DesignProject,
  DesignSystemDetail,
  DesignSystems,
  designRoutes,
} from '../routes';

describe('design routes', () => {
  it('declares the four screens of the spec without a splat', () => {
    expect(designRoutes.map((route) => route.path)).toEqual([
      'design',
      'design/systems',
      'design/systems/:systemId',
      'design/:projectId',
    ]);
    expect(designRoutes.every((route) => typeof route.lazy === 'function')).toBe(true);
    expect(designRoutes.some((route) => route.path?.includes('*'))).toBe(false);
  });

  it('loads a component for every screen', async () => {
    for (const load of [DesignHome, DesignProject, DesignSystems, DesignSystemDetail]) {
      const { Component } = await load();
      expect(typeof Component).toBe('function');
    }
  });
});
