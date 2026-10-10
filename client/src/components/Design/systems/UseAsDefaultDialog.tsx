import { useState } from 'react';
import { Button, useToastContext } from '@librechat/client';
import type { DesignSystemSummary } from '../api/types';
import { useSetCompanyDefaultDesignSystemMutation } from '../api/queries';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import { useDesignLocalize, type DesignTranslationKey } from '../i18n';
import ActionDialog from './ActionDialog';

function errorKeyOf(error: unknown): DesignTranslationKey {
  switch (designErrorCode(error)) {
    case 'permission_required':
    case 'hub_refused':
      return 'systems.use_as_default_forbidden';
    case 'design_system_not_allowed':
    case 'design_system_not_found':
      return 'systems.use_as_default_not_allowed';
    default: {
      const key = designErrorMessageKey(error);
      return key === 'error_generic' ? 'systems.use_as_default_error' : key;
    }
  }
}

export default function UseAsDefaultDialog({ system }: { system: DesignSystemSummary }) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const [open, setOpen] = useState(false);
  const mutation = useSetCompanyDefaultDesignSystemMutation();

  const onOpenChange = (next: boolean) => {
    if (mutation.isLoading) {
      return;
    }
    setOpen(next);
    if (!next) {
      mutation.reset();
    }
  };

  const confirm = () => {
    mutation.mutate(system.id, {
      onSuccess: () => {
        setOpen(false);
        showToast({
          status: 'success',
          message: localize('systems.use_as_default_done', { system: system.name }),
        });
      },
    });
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {localize('systems.use_as_default')}
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={onOpenChange}
        title={localize('systems.use_as_default_title', { system: system.name })}
        description={localize('systems.use_as_default_body', { system: system.name })}
        error={mutation.isError ? localize(errorKeyOf(mutation.error)) : null}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isLoading}
              onClick={() => onOpenChange(false)}
            >
              {localize('systems.cancel')}
            </Button>
            <Button type="button" disabled={mutation.isLoading} onClick={confirm}>
              {localize('systems.use_as_default')}
            </Button>
          </>
        }
      />
    </>
  );
}
