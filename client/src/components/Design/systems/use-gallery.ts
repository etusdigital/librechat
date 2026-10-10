import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SystemDefaults } from './SystemBadges';
import type { DesignMe } from '../api/types';
import { DESIGN_QUERY } from '../paths';

export const GALLERY_SEARCH_DEBOUNCE_MS = 250;
export const FALLBACK_COMPANY_DEFAULT = 'etus';

export function systemDefaultsOf(me: DesignMe): SystemDefaults {
  return {
    personal: me.defaultDesignSystem || null,
    company: me.companyDefaultDesignSystem || FALLBACK_COMPANY_DEFAULT,
  };
}

export function useGalleryParams() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const projectId = params.get(DESIGN_QUERY.project) || null;

  const update = useCallback(
    (changes: Record<string, string>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) {
              next.set(key, value);
            } else {
              next.delete(key);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { query, category, projectId, update };
}

export function useDebouncedValue(value: string, onSettle: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const settled = useRef(value);

  useEffect(() => {
    if (value !== settled.current) {
      settled.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === settled.current) {
      return;
    }
    const timer = setTimeout(() => {
      settled.current = draft;
      onSettle(draft);
    }, GALLERY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onSettle]);

  return [draft, setDraft] as const;
}

export function useInfiniteSentinel(onVisible: () => void, enabled: boolean) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    if (!node || !enabled || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          callback.current();
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled]);

  return setNode;
}

export function useStableList<T>(pages: { items: T[] }[] | undefined) {
  return useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
}
