import { useMemo } from 'react';
import type { DesignMe, DesignPermission } from './api/types';
import { DESIGN_ERROR_CODES, designErrorCode, isDesignApiError } from './api/errors';
import { useAuthContext } from '~/hooks/AuthContext';
import { useDesignMeQuery } from './api/queries';

export const DESIGN_ENTRY_PERMISSION: DesignPermission = 'projects.use';

export type DesignAccess =
  | { status: 'loading' }
  | { status: 'granted'; me: DesignMe }
  | { status: 'denied' }
  | { status: 'reauth' }
  | { status: 'unavailable'; retryAfterSeconds: number | null }
  | { status: 'error' };

export function hasDesignPermission(me: DesignMe | undefined, permission: DesignPermission) {
  return Boolean(me?.permissions.includes(permission));
}

export function designAccessOf({
  me,
  error,
  isLoading,
}: {
  me?: DesignMe;
  error?: unknown;
  isLoading: boolean;
}): DesignAccess {
  if (me) {
    return hasDesignPermission(me, DESIGN_ENTRY_PERMISSION)
      ? { status: 'granted', me }
      : { status: 'denied' };
  }
  if (error) {
    switch (designErrorCode(error)) {
      case DESIGN_ERROR_CODES.notAllowed:
      case DESIGN_ERROR_CODES.disabled:
        return { status: 'denied' };
      case DESIGN_ERROR_CODES.reauthRequired:
        return { status: 'reauth' };
      case DESIGN_ERROR_CODES.hubUnavailable:
        return {
          status: 'unavailable',
          retryAfterSeconds: isDesignApiError(error) ? error.retryAfterSeconds : null,
        };
      default:
        return { status: 'error' };
    }
  }
  return isLoading ? { status: 'loading' } : { status: 'error' };
}

export function useDesignAccess() {
  const { isAuthenticated, user } = useAuthContext();
  const enabled = Boolean(isAuthenticated && user);
  const query = useDesignMeQuery({ enabled });
  const access = useMemo(
    () =>
      designAccessOf({
        me: query.data,
        error: query.error,
        isLoading: !enabled || query.isLoading,
      }),
    [enabled, query.data, query.error, query.isLoading],
  );
  return { access, retry: query.refetch, isFetching: query.isFetching };
}
