import { act, renderHook } from '@testing-library/react';
import { usePendingBrief, useSetPendingBrief } from '../state/pending-brief';

describe('pending brief', () => {
  it('keeps the brief for the project until the chat consumes it', () => {
    const { result: setter } = renderHook(() => useSetPendingBrief());
    const { result } = renderHook(() => usePendingBrief('prj_brief'));
    expect(result.current.brief).toBeNull();
    act(() => setter.current('prj_brief', '  landing com preços  '));
    expect(result.current.brief).toBe('landing com preços');
    let consumed: string | null = null;
    act(() => {
      consumed = result.current.consume();
    });
    expect(consumed).toBe('landing com preços');
    expect(result.current.brief).toBeNull();
  });

  it('stores nothing for an empty brief', () => {
    const { result: setter } = renderHook(() => useSetPendingBrief());
    const { result } = renderHook(() => usePendingBrief('prj_empty'));
    act(() => setter.current('prj_empty', '   '));
    expect(result.current.brief).toBeNull();
  });
});
