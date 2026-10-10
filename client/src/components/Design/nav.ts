import { useMemo } from 'react';
import { Palette } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { TranslationKeys } from '~/hooks';
import type { NavLink } from '~/common';
import { useDesignAccess } from './access';
import { DESIGN_HOME_PATH } from './paths';
import { designKey } from './i18n';

export const DESIGN_NAV_ID = 'etus-design';

export function useDesignNavLink(): NavLink | null {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { access } = useDesignAccess();
  const granted = access.status === 'granted';

  return useMemo(() => {
    if (!granted) {
      return null;
    }
    return {
      title: designKey('nav_design') as TranslationKeys,
      label: '',
      icon: Palette,
      id: DESIGN_NAV_ID,
      onClick: () => {
        if (pathname !== DESIGN_HOME_PATH) {
          navigate(DESIGN_HOME_PATH);
        }
      },
    };
  }, [granted, navigate, pathname]);
}
