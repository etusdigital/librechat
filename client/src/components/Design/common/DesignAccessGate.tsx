import { Lock } from 'lucide-react';
import { Button } from '@librechat/client';
import type { ReactNode } from 'react';
import type { DesignMe } from '../api/types';
import { DesignCardsSkeleton, DesignErrorState } from './DesignStates';
import { useAuthContext } from '~/hooks/AuthContext';
import { useDesignAccess } from '../access';
import { useDesignLocalize } from '../i18n';

export default function DesignAccessGate({ children }: { children: (me: DesignMe) => ReactNode }) {
  const localize = useDesignLocalize();
  const { logout } = useAuthContext();
  const { access, retry } = useDesignAccess();
  const onRetry = () => {
    retry();
  };

  switch (access.status) {
    case 'granted':
      return <>{children(access.me)}</>;
    case 'loading':
      return <DesignCardsSkeleton label={localize('access_checking')} />;
    case 'denied':
      return <DesignErrorState icon={Lock} message={localize('access_denied')} />;
    case 'reauth':
      return (
        <DesignErrorState
          icon={Lock}
          message={localize('access_reauth')}
          action={
            <Button type="button" variant="default" size="sm" onClick={() => logout('/login')}>
              {localize('access_reauth_action')}
            </Button>
          }
        />
      );
    case 'unavailable':
      return <DesignErrorState message={localize('error_hub_unavailable')} onRetry={onRetry} />;
    default:
      return <DesignErrorState message={localize('error_generic')} onRetry={onRetry} />;
  }
}
