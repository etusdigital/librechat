import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';
import { useDesignNavLink } from '../nav';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true, user: { id: 'u1' }, logout: jest.fn() }),
}));

jest.mock('../api/client', () => ({ designApi: { me: jest.fn() } }));

const meMock = designApi.me as jest.Mock;

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/c/new']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(() => ({ link: useDesignNavLink(), location: useLocation() }), { wrapper });
}

describe('Design menu item', () => {
  it('appears for people with projects.use and opens /design', async () => {
    meMock.mockResolvedValue({
      sub: 's',
      name: 'Ana',
      orgId: 'o',
      permissions: ['projects.use'],
      defaultDesignSystem: 'etus',
    });
    const { result } = setup();
    expect(result.current.link).toBeNull();
    await waitFor(() => expect(result.current.link).not.toBeNull());
    expect(result.current.link).toMatchObject({
      id: 'etus-design',
      title: 'etus-design:nav_design',
    });
    act(() => result.current.link?.onClick?.());
    expect(result.current.location.pathname).toBe('/design');
  });

  it.each([
    ['without the permission', () => meMock.mockResolvedValue({ permissions: ['media.image'] })],
    [
      'when the hub refuses',
      () =>
        meMock.mockRejectedValue(new DesignApiError({ status: 403, code: 'design_not_allowed' })),
    ],
    [
      'when the hub is down',
      () => meMock.mockRejectedValue(new DesignApiError({ status: 503, code: 'hub_unavailable' })),
    ],
  ])('stays hidden %s', async (_label, arrange) => {
    arrange();
    const { result } = setup();
    await waitFor(() => expect(meMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.link).toBeNull();
  });
});
