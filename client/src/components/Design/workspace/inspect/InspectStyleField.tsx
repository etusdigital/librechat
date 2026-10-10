import { useEffect, useId, useState } from 'react';
import { Input } from '@librechat/client';
import type { KeyboardEvent } from 'react';
import type { EditableCssProperty } from '../../preview/host-protocol';
import type { TokenOption } from './design-tokens';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

const chip =
  'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-light px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:pointer-events-none disabled:opacity-50';

function TokenChips({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: TokenOption[];
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <li key={option.value} className="max-w-full">
          <button
            type="button"
            title={option.value}
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onPick(option.value)}
            className={cn(chip, value === option.value && 'bg-surface-active text-text-primary')}
          >
            {option.swatch ? (
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 rounded-sm border border-border-medium"
                style={{ backgroundColor: option.swatch }}
              />
            ) : null}
            <span className="truncate">{option.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function InspectStyleField({
  property,
  label,
  value,
  placeholder,
  options = [],
  collapseOptions = false,
  disabled,
  onCommit,
}: {
  property: EditableCssProperty;
  label: string;
  value: string;
  placeholder?: string;
  options?: TokenOption[];
  collapseOptions?: boolean;
  disabled: boolean;
  onCommit: (property: EditableCssProperty, value: string) => boolean;
}) {
  const localize = useDesignLocalize();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const commit = (next: string) => {
    if (next.trim() === value.trim()) {
      setInvalid(false);
      return;
    }
    const accepted = onCommit(property, next);
    setInvalid(!accepted);
    if (accepted) {
      setDraft(next.trim());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Escape') {
      setDraft(value);
      setInvalid(false);
    }
  };

  const tokensLabel = localize('inspect.tokens_for', { name: label });
  const chips =
    options.length > 0 ? (
      <TokenChips
        label={tokensLabel}
        options={options}
        value={value}
        disabled={disabled}
        onPick={(picked) => {
          setDraft(picked);
          commit(picked);
        }}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={onKeyDown}
        className="h-8 font-mono text-xs"
      />
      {invalid ? (
        <p id={`${id}-error`} className="text-xs text-text-destructive">
          {localize('inspect.invalid_value')}
        </p>
      ) : null}
      {chips && collapseOptions ? (
        <details className="group">
          <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
            {localize('inspect.tokens_toggle', { count: options.length })}
          </summary>
          <div className="pt-2">{chips}</div>
        </details>
      ) : (
        chips
      )}
    </div>
  );
}
