import { useMemo, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToastContext } from '@librechat/client';
import type { TokenEntry } from '../api/types';
import { contrastPairsOf, formatRatio, type ContrastLevel } from './contrast';
import { useDesignLocalize, type DesignTranslationKey } from '../i18n';
import { cn } from '~/utils';

const LEVEL_KEYS: Record<ContrastLevel, DesignTranslationKey> = {
  aa: 'systems.contrast_aa',
  large: 'systems.contrast_large',
  fail: 'systems.contrast_fail',
};

const LEVEL_CLASSES: Record<ContrastLevel, string> = {
  aa: 'border-status-success-border bg-status-success-subtle',
  large: 'border-status-warning-border bg-status-warning-subtle',
  fail: 'border-status-error-border bg-status-error-subtle',
};

function Swatch({ color }: { color: TokenEntry }) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    copy(color.value);
    setCopied(true);
    showToast({ status: 'success', message: localize('systems.copied', { value: color.value }) });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-border-light bg-surface-primary p-2">
      <span
        aria-hidden="true"
        className="size-12 shrink-0 rounded-lg border border-border-light"
        style={{ background: color.value }}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-primary">{color.name}</span>
        <code className="truncate text-xs text-text-secondary">{`var(${color.cssVar})`}</code>
        <code className="truncate text-xs text-text-secondary">{color.value}</code>
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={localize('systems.copy_value', { value: color.value, name: color.name })}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

function ContrastTable({ colors }: { colors: TokenEntry[] }) {
  const localize = useDesignLocalize();
  const { i18n } = useTranslation();
  const pairs = useMemo(() => contrastPairsOf(colors), [colors]);

  if (pairs.length === 0) {
    return <p className="text-sm text-text-secondary">{localize('systems.contrast_empty')}</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {pairs.map((pair) => (
        <li
          key={`${pair.foreground.name}-${pair.background.name}`}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-border-light bg-surface-primary p-2"
        >
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border-light text-lg font-semibold"
            style={{ background: pair.background.value, color: pair.foreground.value }}
          >
            {localize('systems.sample_glyphs')}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm text-text-primary">
              {localize('systems.contrast_pair', {
                fg: pair.foreground.name,
                bg: pair.background.name,
              })}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-text-primary">
                {localize('systems.contrast_ratio', {
                  ratio: formatRatio(pair.ratio, i18n.language),
                })}
              </span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs font-medium text-text-primary',
                  LEVEL_CLASSES[pair.level],
                )}
              >
                {localize(LEVEL_KEYS[pair.level])}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ColorSwatches({ colors }: { colors: TokenEntry[] }) {
  const localize = useDesignLocalize();
  if (colors.length === 0) {
    return <p className="text-sm text-text-secondary">{localize('systems.colors_empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {colors.map((color) => (
          <Swatch key={color.cssVar} color={color} />
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {localize('systems.contrast_heading')}
        </h3>
        <p className="text-sm text-text-secondary">{localize('systems.contrast_intro')}</p>
        <ContrastTable colors={colors} />
      </div>
    </div>
  );
}
