import type { DesignMe } from '../api/types';
import { designAccessOf, hasDesignPermission } from '../access';
import { DesignApiError } from '../api/errors';

const me = (permissions: string[]): DesignMe => ({
  sub: 'sub-1',
  name: 'Ana',
  orgId: 'org_1',
  permissions,
  defaultDesignSystem: 'etus',
});

const apiError = (status: number, code: string, retryAfterSeconds: number | null = null) =>
  new DesignApiError({ status, code, retryAfterSeconds });

describe('designAccessOf', () => {
  it('grants access only with projects.use', () => {
    expect(designAccessOf({ me: me(['projects.use']), isLoading: false })).toEqual({
      status: 'granted',
      me: me(['projects.use']),
    });
    expect(designAccessOf({ me: me(['media.image']), isLoading: false })).toEqual({
      status: 'denied',
    });
    expect(designAccessOf({ me: me([]), isLoading: false })).toEqual({ status: 'denied' });
  });

  it('is loading while the first answer has not arrived', () => {
    expect(designAccessOf({ isLoading: true })).toEqual({ status: 'loading' });
  });

  it('maps the proxy errors to the screen states', () => {
    expect(
      designAccessOf({ error: apiError(403, 'design_not_allowed'), isLoading: false }),
    ).toEqual({ status: 'denied' });
    expect(designAccessOf({ error: apiError(404, 'design_disabled'), isLoading: false })).toEqual({
      status: 'denied',
    });
    expect(designAccessOf({ error: apiError(401, 'reauth_required'), isLoading: false })).toEqual({
      status: 'reauth',
    });
    expect(
      designAccessOf({ error: apiError(503, 'hub_unavailable', 7), isLoading: false }),
    ).toEqual({ status: 'unavailable', retryAfterSeconds: 7 });
    expect(
      designAccessOf({ error: apiError(502, 'design_unavailable'), isLoading: false }),
    ).toEqual({ status: 'error' });
    expect(designAccessOf({ error: new TypeError('Failed'), isLoading: false })).toEqual({
      status: 'error',
    });
  });

  it('checks single permissions', () => {
    expect(hasDesignPermission(me(['projects.use']), 'projects.use')).toBe(true);
    expect(hasDesignPermission(me(['projects.use']), 'admin.all')).toBe(false);
    expect(hasDesignPermission(undefined, 'projects.use')).toBe(false);
  });
});
