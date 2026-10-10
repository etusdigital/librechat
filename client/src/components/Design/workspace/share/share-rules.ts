import type { DesignMe, DesignProject } from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';

export const PUBLIC_LINK_DAYS = [1, 3, 7, 14, 30] as const;
export const PUBLIC_LINK_DEFAULT_DAYS = 7;

export interface ShareRules {
  canManage: boolean;
  canShareCompany: boolean;
  canSharePublic: boolean;
  reasonKey: DesignTranslationKey | null;
}

export function sharePermissionsOf(
  project: Pick<DesignProject, 'canWrite'>,
  me: Pick<DesignMe, 'permissions'> | undefined,
): ShareRules {
  const permissions = me?.permissions ?? [];
  const canShareCompany = permissions.includes('projects.share-company');
  const canSharePublic = permissions.includes('projects.share-public');
  if (!project.canWrite) {
    return {
      canManage: false,
      canShareCompany: false,
      canSharePublic: false,
      reasonKey: 'actions.share_reason_read_only',
    };
  }
  if (!canShareCompany && !canSharePublic) {
    return {
      canManage: false,
      canShareCompany,
      canSharePublic,
      reasonKey: 'actions.share_reason_no_permission',
    };
  }
  return { canManage: true, canShareCompany, canSharePublic, reasonKey: null };
}
