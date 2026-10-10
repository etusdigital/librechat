import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { DesignMe, DesignProject, DesignSystemSummary, DesignTemplate } from '../api/types';
import { usePendingBrief } from '../state/pending-brief';
import DesignHomePage from '../home/DesignHomePage';
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
    listProjects: jest.fn(),
    listTemplates: jest.fn(),
    listDesignSystems: jest.fn(),
    createProject: jest.fn(),
    previewUrl: jest.fn(),
  },
}));

type ApiName =
  | 'me'
  | 'listProjects'
  | 'listTemplates'
  | 'listDesignSystems'
  | 'createProject'
  | 'previewUrl';
const api = designApi as unknown as Record<ApiName, jest.Mock>;

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const project = (overrides: Partial<DesignProject> = {}): DesignProject => ({
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'airbnb',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 's', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  ...overrides,
});

const system = (id: string, name: string, extra: Partial<DesignSystemSummary> = {}) => ({
  id,
  name,
  category: 'Productivity & SaaS',
  summary: '',
  license: 'MIT',
  hasComponents: false,
  thumbnailUrl: null,
  swatches: ['#111111', '#eeeeee'],
  headingFont: 'Inter, sans-serif',
  ...extra,
});

const systems = [
  system('etus', 'Etus', { category: 'Starter' }),
  system('airbnb', 'Airbnb', { category: 'Media & Consumer', inspiredBy: 'Airbnb' }),
  system('linear', 'Linear'),
];

const template = (
  id: string,
  name: string,
  kind: DesignTemplate['kind'],
  previewUrl: string | null = `https://chat.test/preview/t/${id}/`,
): DesignTemplate => ({
  id,
  name,
  kind,
  category: null,
  description: `${name} description`,
  license: 'MIT',
  previewUrl,
});

const templates = [
  template('tpl-landing-saas', 'Landing SaaS', 'prototype'),
  template('tpl-pitch-deck', 'Pitch deck', 'deck'),
  template('tpl-weekly-deck', 'Weekly deck', 'deck', null),
];

const error = (status: number, code: string) => new DesignApiError({ status, code });

function systemsPage({ query = '', category = '' }: { query?: string; category?: string }) {
  const items = systems.filter(
    (item) =>
      (!query || item.name.toLowerCase().includes(query.toLowerCase())) &&
      (!category || item.category === category),
  );
  return {
    items,
    nextCursor: null,
    total: items.length,
    categories: ['Media & Consumer', 'Productivity & SaaS', 'Starter'],
  };
}

function BriefProbe() {
  const { projectId = '' } = useParams();
  const { brief } = usePendingBrief(projectId);
  return (
    <div>
      <p>{`workspace ${projectId}`}</p>
      <p>{`brief: ${brief ?? 'none'}`}</p>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path = '/design') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/design" element={<DesignHomePage />} />
          <Route path="/design/systems" element={<p>{'gallery'}</p>} />
          <Route path="/design/:projectId" element={<BriefProbe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  api.me.mockResolvedValue(me);
  api.listProjects.mockResolvedValue({ items: [], nextCursor: null });
  api.listTemplates.mockResolvedValue({ items: templates });
  api.listDesignSystems.mockImplementation(async (params) => systemsPage(params));
  api.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2026-10-10T12:00:00.000Z',
  });
});

describe('Design home grid', () => {
  it('shows each project with its thumbnail, kind, date and design system badge', async () => {
    api.listProjects.mockResolvedValue({ items: [project()], nextCursor: null });
    renderAt();
    const card = await screen.findByRole('link', { name: /Landing Produto X/ });
    expect(card).toHaveAttribute('href', '/design/prj_abc');
    expect(within(card).getByText('Prototype')).toBeVisible();
    expect(within(card).getByText(/^Updated /)).toBeVisible();
    expect(await within(card).findByText('Airbnb')).toBeVisible();
    const frame = await waitFor(() => {
      const found = card.querySelector('iframe');
      expect(found).not.toBeNull();
      return found as HTMLIFrameElement;
    });
    expect(frame).toHaveAttribute('src', 'https://chat.test/preview/p/tok/index.html');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('tabindex', '-1');
    expect(api.previewUrl).toHaveBeenCalledWith('prj_abc', {});
  });

  it('falls back to the color card when the project has no entry file yet', async () => {
    api.listProjects.mockResolvedValue({ items: [project()], nextCursor: null });
    api.previewUrl.mockRejectedValue(error(404, 'file_not_found'));
    renderAt();
    const card = await screen.findByRole('link', { name: /Landing Produto X/ });
    await waitFor(() => expect(api.previewUrl).toHaveBeenCalled());
    expect(card.querySelector('iframe')).toBeNull();
    expect(within(card).getByText('Aa')).toBeInTheDocument();
  });

  it('shows the design system id when the catalog does not know it', async () => {
    api.listProjects.mockResolvedValue({
      items: [project({ designSystemId: 'retired-system' })],
      nextCursor: null,
    });
    renderAt();
    const card = await screen.findByRole('link', { name: /Landing Produto X/ });
    expect(within(card).getByText('retired-system')).toBeVisible();
  });

  it('switches between my, shared and company projects', async () => {
    api.listProjects.mockImplementation(async ({ scope }) =>
      scope === 'shared'
        ? {
            items: [
              project({
                projectId: 'prj_s',
                name: 'Deck do Bruno',
                owner: { sub: 'b', name: 'Bruno' },
              }),
            ],
            nextCursor: null,
          }
        : { items: [], nextCursor: null },
    );
    renderAt();
    expect(
      await screen.findByText('You have no projects yet. Start from a template'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Shared with me' }));
    expect(await screen.findByText('By Bruno')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Shared with me' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/design?tab=shared');
    await userEvent.click(screen.getByRole('tab', { name: 'Company' }));
    expect(
      await screen.findByText('No projects are shared with the whole company yet.'),
    ).toBeVisible();
    expect(api.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'company', limit: 48 }),
      expect.anything(),
    );
  });

  it('loads the next page on demand', async () => {
    api.listProjects
      .mockResolvedValueOnce({ items: [project()], nextCursor: 'c2' })
      .mockResolvedValueOnce({
        items: [project({ projectId: 'prj_2', name: 'Segundo projeto' })],
        nextCursor: null,
      });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: /Segundo projeto/ })).toBeVisible();
    expect(api.listProjects).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c2' }),
      expect.anything(),
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('links to the design systems gallery', async () => {
    renderAt();
    await userEvent.click(await screen.findByRole('link', { name: /Design systems/ }));
    expect(await screen.findByText('gallery')).toBeVisible();
  });

  it('offers templates when the person has no projects, only with the kinds that exist', async () => {
    renderAt();
    const gallery = await screen.findByRole('region', { name: 'Templates' });
    const filters = await within(gallery).findByRole('group', { name: 'Filter templates by type' });
    expect(
      within(filters)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['All', 'Prototype', 'Deck']);
    await userEvent.click(within(filters).getByRole('button', { name: 'Deck' }));
    expect(within(gallery).queryByText('Landing SaaS')).not.toBeInTheDocument();
    await userEvent.click(
      within(gallery).getByRole('button', { name: /Pitch deck/, pressed: false }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Step 3 of 4: Design system')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/design?new=1&kind=deck&template=tpl-pitch-deck',
    );
  });
});

describe('Template gallery states', () => {
  it('shows a skeleton while templates load and an error with retry when they fail', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    api.listTemplates.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    renderAt();
    const gallery = await screen.findByText('Templates');
    expect(
      await screen.findByText('You have no projects yet. Start from a template'),
    ).toBeVisible();
    expect(gallery.parentElement?.querySelector('[role="status"]')).not.toBeNull();
    fail(error(500, 'internal_error'));
    expect(await screen.findByText('The templates could not be loaded.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /Landing SaaS description/ })).toBeVisible();
  });
});

describe('New project dialog', () => {
  async function openDialog(path = '/design') {
    renderAt(path);
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    return screen.findByRole('dialog');
  }

  it('walks through type, template, design system and details, then opens the workspace with the brief', async () => {
    api.createProject.mockResolvedValue(project({ projectId: 'prj_new', kind: 'deck' }));
    const dialog = await openDialog();
    expect(within(dialog).getByText('Step 1 of 4: Type')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Deck/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(within(dialog).getByText('Step 2 of 4: Template')).toBeVisible();
    expect(await within(dialog).findByText('Pitch deck')).toBeVisible();
    expect(within(dialog).queryByText('Landing SaaS')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Blank/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Pitch deck description/ }));
    expect(within(dialog).getByRole('button', { name: /Pitch deck description/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getAllByRole('button', { name: /^Preview / })).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview Pitch deck' }));
    const preview = await screen.findByTitle('Preview of the Pitch deck template');
    expect(preview).toHaveAttribute('src', 'https://chat.test/preview/t/tpl-pitch-deck/');
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByTitle('Preview of the Pitch deck template')).not.toBeInTheDocument(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(within(dialog).getByText('Step 3 of 4: Design system')).toBeVisible();
    expect(
      await within(dialog).findByRole('button', { name: /Etus/, pressed: true }),
    ).toBeVisible();
    await userEvent.type(
      within(dialog).getByRole('searchbox', { name: 'Search design systems' }),
      'air',
    );
    await waitFor(() =>
      expect(api.listDesignSystems).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'air' }),
        expect.anything(),
      ),
    );
    await userEvent.click(
      await within(dialog).findByRole('button', { name: /Airbnb.*Inspired by Airbnb/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(within(dialog).getByText('Step 4 of 4: Name and request')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Landing Produto X');
    await userEvent.type(
      within(dialog).getByLabelText('Describe what you want (optional)'),
      'landing para pequenas empresas, com preços e depoimentos',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    expect(await screen.findByText('workspace prj_new')).toBeVisible();
    expect(api.createProject).toHaveBeenCalledWith({
      name: 'Landing Produto X',
      kind: 'deck',
      designSystemId: 'airbnb',
      templateId: 'tpl-pitch-deck',
    });
    expect(
      screen.getByText('brief: landing para pequenas empresas, com preços e depoimentos'),
    ).toBeVisible();
  });

  it('only offers a blank start for kinds without templates', async () => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Document/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(
      await within(dialog).findByText(
        'There are no templates of this type yet. Start blank and describe what you want.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: /Blank/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).queryByText('Pitch deck')).not.toBeInTheDocument();
  });

  it('preselects the default design system from the hub', async () => {
    api.me.mockResolvedValue({ ...me, defaultDesignSystem: 'linear' });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const linear = await within(dialog).findByRole('button', { name: /Linear/, pressed: true });
    expect(within(linear).getByText('Default')).toBeVisible();
  });

  it('filters design systems by category and shows the empty state', async () => {
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    const categories = await within(dialog).findByRole('group', { name: 'Categories' });
    await userEvent.click(within(categories).getByRole('button', { name: 'Media & Consumer' }));
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: /Linear/ })).not.toBeInTheDocument(),
    );
    expect(within(dialog).getByRole('button', { name: /Airbnb/ })).toBeVisible();
    await userEvent.type(
      within(dialog).getByRole('searchbox', { name: 'Search design systems' }),
      'zzz',
    );
    expect(await within(dialog).findByText('No design system matches this search')).toBeVisible();
  });

  it('shows an error with retry when the design systems fail to load', async () => {
    api.listDesignSystems.mockRejectedValue(error(500, 'internal_error'));
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(
      await within(dialog).findByText('The design systems could not be loaded.'),
    ).toBeVisible();
    api.listDesignSystems.mockImplementation(async (params) => systemsPage(params));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('button', { name: /Etus/ })).toBeVisible();
  });

  it('explains when the project limit is reached', async () => {
    api.createProject.mockRejectedValue(error(409, 'too_many_projects'));
    renderAt('/design?new=1&template=tpl-landing-saas');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Step 3 of 4: Design system')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Outro');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You reached the project limit.',
    );
    expect(screen.queryByText(/^workspace /)).not.toBeInTheDocument();
  });

  it('opens with the system chosen in the gallery and closes back to the grid', async () => {
    renderAt('/design?new=1&system=airbnb');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Step 1 of 4: Type')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(
      await within(dialog).findByRole('button', { name: /Airbnb/, pressed: true }),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/design$/);
  });
});
