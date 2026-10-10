import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  airbnb,
  etus,
  me,
  minimal,
  page,
  project,
  summary,
} from '../systems/__fixtures__/design-systems';
import DesignSystemsPage from '../systems/DesignSystemsPage';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true, user: { id: 'u1' }, logout: jest.fn() }),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../api/client', () => ({
  designApi: {
    me: jest.fn(),
    listDesignSystems: jest.fn(),
    getDesignSystem: jest.fn(),
    getProject: jest.fn(),
  },
}));

type ApiName = 'me' | 'listDesignSystems' | 'getDesignSystem' | 'getProject';
const api = designApi as unknown as Record<ApiName, jest.Mock>;

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderGallery(path = '/design/systems') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/design/systems" element={<DesignSystemsPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function withSystems(...items: Parameters<typeof page>[0]) {
  api.me.mockResolvedValue(me);
  api.getDesignSystem.mockImplementation(async (id: string) => {
    if (id === 'etus') {
      return etus;
    }
    throw new DesignApiError({ status: 404, code: 'design_system_not_found' });
  });
  api.listDesignSystems.mockResolvedValue(page(items));
}

const grid = () => screen.getByRole('list', { name: 'Design systems' });

describe('Design systems gallery (C-15)', () => {
  it('shows a skeleton while the systems load', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockReturnValue(new Promise(() => undefined));
    api.listDesignSystems.mockReturnValue(new Promise(() => undefined));
    renderGallery();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your access to Etus Design');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading'));
    expect(screen.getByRole('heading', { level: 1, name: 'Design systems' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search design systems' })).toBeVisible();
  });

  it('shows an error with retry', async () => {
    withSystems();
    api.listDesignSystems
      .mockRejectedValueOnce(new DesignApiError({ status: 400, code: 'invalid_cursor' }))
      .mockResolvedValue(page([airbnb]));
    renderGallery();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The design systems could not be loaded.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Airbnb' })).toBeVisible();
  });

  it('shows the empty state for a search without results and clears the filters', async () => {
    withSystems();
    api.listDesignSystems.mockImplementation(async ({ query }: { query?: string }) =>
      query ? page([], { total: 0 }) : page([airbnb]),
    );
    renderGallery('/design/systems?q=zzz');
    expect(await screen.findByText('No design system found for this search')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Airbnb' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/design\/systems$/);
  });

  it('shows thumbnails, the color card fallback and the inspired by badge only on brands', async () => {
    withSystems(airbnb, minimal);
    const { container } = renderGallery();
    const brand = await screen.findByRole('link', { name: 'Airbnb' });
    expect(brand).toHaveAccessibleDescription(/Travel/);
    expect(brand).toHaveAccessibleDescription(/Inspired by Airbnb/);
    const thumbnail = brand.querySelector('img');
    expect(thumbnail).toHaveAttribute(
      'src',
      'http://localhost:3080/preview/ds/airbnb/thumbnail.png',
    );
    expect(thumbnail).toHaveAttribute('alt', '');
    expect(thumbnail).toHaveAttribute('loading', 'lazy');

    const plain = screen.getByRole('link', { name: 'Minimal' });
    expect(plain.querySelector('img')).toBeNull();
    expect(plain).not.toHaveAccessibleDescription(/Inspired by/);
    expect(within(plain).getByText('Aa')).toBeInTheDocument();

    fireEvent.error(thumbnail as HTMLImageElement);
    expect(brand.querySelector('img')).toBeNull();
    expect(within(brand).getByText('Aa')).toBeInTheDocument();
    expect(container.querySelectorAll('[style*="background"]').length).toBeGreaterThan(0);
  });

  it('highlights the company default above the grid and marks the personal default', async () => {
    api.me.mockResolvedValue({ ...me, defaultDesignSystem: 'minimal' });
    api.getDesignSystem.mockResolvedValue(etus);
    api.listDesignSystems.mockResolvedValue(page([etus, airbnb, minimal]));
    renderGallery();
    const featured = await screen.findByRole('region', { name: 'Company default' });
    const etusCard = within(featured).getByRole('link', { name: 'Etus' });
    expect(etusCard).toHaveAccessibleDescription(/Company default/);
    expect(within(grid()).queryByRole('link', { name: 'Etus' })).toBeNull();
    expect(within(grid()).getByRole('link', { name: 'Minimal' })).toHaveAccessibleDescription(
      /Default/,
    );
    expect(api.getDesignSystem).toHaveBeenCalledWith('etus', expect.anything());
  });

  it('filters the grid by search and category', async () => {
    withSystems(airbnb, minimal);
    api.listDesignSystems.mockImplementation(
      async ({ query, category }: { query?: string; category?: string }) => {
        if (category === 'Travel') {
          return page([airbnb], { total: 1 });
        }
        if (query === 'mini') {
          return page([minimal], { total: 1 });
        }
        return page([airbnb, minimal]);
      },
    );
    renderGallery();
    await screen.findByRole('link', { name: 'Airbnb' });
    expect(screen.getByText('Design systems found: 2')).toBeVisible();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search design systems' }), 'mini');
    await waitFor(() => expect(within(grid()).queryByRole('link', { name: 'Airbnb' })).toBeNull());
    expect(within(grid()).getByRole('link', { name: 'Minimal' })).toBeVisible();
    expect(api.listDesignSystems).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'mini', limit: 48, cursor: null }),
      expect.anything(),
    );
    expect(screen.queryByRole('region', { name: 'Company default' })).toBeNull();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search design systems' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Travel');
    await waitFor(() => expect(within(grid()).queryByRole('link', { name: 'Minimal' })).toBeNull());
    expect(api.listDesignSystems).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'Travel' }),
      expect.anything(),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('category=Travel');
  });

  it('loads the next 48 when the end of the grid comes into view', async () => {
    const observers: { callback: IntersectionObserverCallback }[] = [];
    const original = window.IntersectionObserver;
    window.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
      observers.push({ callback });
      return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() };
    }) as unknown as typeof IntersectionObserver;
    try {
      const first = Array.from({ length: 48 }, (_, index) => summary(`system${index}`));
      withSystems();
      api.listDesignSystems.mockImplementation(async ({ cursor }: { cursor?: string | null }) =>
        cursor === '48'
          ? page([summary('last')], { total: 49 })
          : page(first, { total: 49, nextCursor: '48' }),
      );
      renderGallery();
      await screen.findByRole('link', { name: 'System0' });
      expect(within(grid()).getAllByRole('link')).toHaveLength(48);
      await waitFor(() => expect(observers.length).toBeGreaterThan(0));
      observers[observers.length - 1].callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(await screen.findByRole('link', { name: 'Last' })).toBeVisible();
      expect(api.listDesignSystems).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: '48', limit: 48 }),
        expect.anything(),
      );
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    } finally {
      window.IntersectionObserver = original;
    }
  });

  it('offers a load more button where the observer is not available', async () => {
    withSystems();
    api.listDesignSystems.mockImplementation(async ({ cursor }: { cursor?: string | null }) =>
      cursor ? page([minimal], { total: 2 }) : page([airbnb], { total: 2, nextCursor: '1' }),
    );
    renderGallery();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Minimal' })).toBeVisible();
  });

  it('keeps the project it was opened from in every card link', async () => {
    withSystems(airbnb);
    api.getProject.mockResolvedValue({ ...project, files: [] });
    renderGallery('/design/systems?project=prj_abc');
    expect(
      await screen.findByText('Choosing a design system for the project Landing Produto X'),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to the project' })).toHaveAttribute(
      'href',
      '/design/prj_abc',
    );
    expect(await screen.findByRole('link', { name: 'Airbnb' })).toHaveAttribute(
      'href',
      '/design/systems/airbnb?project=prj_abc',
    );
  });
});

describe('Design system cards accessibility', () => {
  it('names each card by the system and reaches them with the keyboard', async () => {
    withSystems(airbnb, minimal);
    renderGallery();
    await screen.findByRole('link', { name: 'Airbnb' });
    const cards = within(grid()).getAllByRole('link');
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      '/design/systems/airbnb',
      '/design/systems/minimal',
    ]);
    for (const card of cards) {
      expect(card).toHaveAccessibleName(/^(Airbnb|Minimal)$/);
      expect(card.className).toContain('focus-visible:ring-2');
    }
    cards[0].focus();
    await userEvent.tab();
    expect(cards[1]).toHaveFocus();
  });

  it('has no serious or critical axe violations', async () => {
    withSystems(airbnb, minimal);
    const { container } = renderGallery();
    await screen.findByRole('link', { name: 'Airbnb' });
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});
