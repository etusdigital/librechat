import { Construction } from 'lucide-react';
import { DesignEmptyState } from '../common/DesignStates';
import DesignAccessGate from '../common/DesignAccessGate';
import { DESIGN_SYSTEMS_PATH } from '../paths';
import DesignPage from '../common/DesignPage';
import { useDesignLocalize } from '../i18n';

export default function DesignSystemDetailPage() {
  const localize = useDesignLocalize();
  return (
    <DesignPage
      title={localize('system_title_fallback')}
      back={{ to: DESIGN_SYSTEMS_PATH, label: localize('systems_back') }}
    >
      <DesignAccessGate>
        {() => <DesignEmptyState icon={Construction} message={localize('systems_soon')} />}
      </DesignAccessGate>
    </DesignPage>
  );
}
