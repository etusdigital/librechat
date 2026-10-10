import { useEffect, useId, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Check, Copy } from 'lucide-react';
import { Button } from '@librechat/client';
import { useDesignLocalize } from '../../i18n';

const COPIED_MS = 2000;

export default function CopyField({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  const localize = useDesignLocalize();
  const inputId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          id={inputId}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className={`min-w-0 flex-1 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${
            monospace ? 'font-mono' : ''
          }`}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCopied(copy(value))}
          aria-label={localize(copied ? 'actions.copied' : 'actions.copy_named', { name: label })}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">
            {localize(copied ? 'actions.copied' : 'actions.copy')}
          </span>
        </Button>
      </div>
    </div>
  );
}
