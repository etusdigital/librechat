import type { ReactNode } from 'react';
import type { DesignSystemTypography, TokenEntry } from '../api/types';
import { useDesignLocalize } from '../i18n';

const MAX_SAMPLE_SIZE = '4rem';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </div>
  );
}

function TokenLabel({ token }: { token: TokenEntry }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 text-xs text-text-secondary">
      <code className="truncate">{`var(${token.cssVar})`}</code>
      <code className="truncate">{token.value}</code>
    </span>
  );
}

export default function TypeSpecimen({
  typography,
  headingFont,
}: {
  typography: DesignSystemTypography;
  headingFont: string | null;
}) {
  const localize = useDesignLocalize();
  const sample = localize('systems.typography_sample');
  const baseFont = typography.families[0]?.value ?? headingFont ?? undefined;
  const empty =
    typography.families.length === 0 &&
    typography.weights.length === 0 &&
    typography.scale.length === 0;

  if (empty) {
    return <p className="text-sm text-text-secondary">{localize('systems.typography_empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-text-secondary">{localize('systems.typography_note')}</p>
      {typography.families.length > 0 ? (
        <Group title={localize('systems.typography_families')}>
          <ul className="flex flex-col gap-2">
            {typography.families.map((family) => (
              <li
                key={family.cssVar}
                className="flex min-w-0 flex-col gap-1 rounded-xl border border-border-light bg-surface-primary p-3"
              >
                <span className="text-sm font-medium text-text-primary">{family.primary}</span>
                <span
                  className="break-words text-2xl text-text-primary"
                  style={{ fontFamily: family.value }}
                >
                  {sample}
                </span>
                <TokenLabel token={family} />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {typography.weights.length > 0 ? (
        <Group title={localize('systems.typography_weights')}>
          <ul className="flex flex-wrap gap-2">
            {typography.weights.map((weight) => (
              <li
                key={weight}
                className="rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-lg text-text-primary"
                style={{ fontFamily: baseFont, fontWeight: weight }}
              >
                {localize('systems.weight_sample', { weight })}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {typography.scale.length > 0 ? (
        <Group title={localize('systems.typography_scale')}>
          <ul className="flex flex-col divide-y divide-border-light rounded-xl border border-border-light bg-surface-primary">
            {typography.scale.map((step) => (
              <li key={step.cssVar} className="flex min-w-0 flex-col gap-1 overflow-hidden p-3">
                <span
                  className="truncate leading-tight text-text-primary"
                  style={{
                    fontFamily: headingFont ?? baseFont,
                    fontSize: `min(${step.value}, ${MAX_SAMPLE_SIZE})`,
                  }}
                >
                  {sample}
                </span>
                <TokenLabel token={step} />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {[
        { title: localize('systems.typography_leading'), tokens: typography.leading },
        { title: localize('systems.typography_tracking'), tokens: typography.tracking },
      ]
        .filter((group) => group.tokens.length > 0)
        .map((group) => (
          <Group key={group.title} title={group.title}>
            <ul className="flex flex-col gap-1">
              {group.tokens.map((token) => (
                <li key={token.cssVar} className="flex min-w-0 flex-wrap gap-x-3 text-sm">
                  <span className="text-text-primary">{token.name}</span>
                  <TokenLabel token={token} />
                </li>
              ))}
            </ul>
          </Group>
        ))}
    </div>
  );
}
