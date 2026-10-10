import { Construction } from 'lucide-react';
import { DesignEmptyState } from '../common/DesignStates';
import DesignAccessGate from '../common/DesignAccessGate';
import DesignPage from '../common/DesignPage';
import { useDesignLocalize } from '../i18n';
import { DESIGN_HOME_PATH } from '../paths';

export default function DesignSystemsPage() {
  const localize = useDesignLocalize();
  return (
    <DesignPage
      title={localize('systems_title')}
      back={{ to: DESIGN_HOME_PATH, label: localize('project_back') }}
    >
      <DesignAccessGate>
        {() => <DesignEmptyState icon={Construction} message={localize('systems_soon')} />}
      </DesignAccessGate>
    </DesignPage>
  );
}
