import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignMe, DesignProject } from '../api/types';
import DesignWorkspacePage from '../workspace/DesignWorkspacePage';
import DesignSystemsPage from '../systems/DesignSystemsPage';
import DesignHomePage from '../home/DesignHomePage';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

const mockLogout = jest.fn();

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true, user: { id: 'u1' }, logout: mockLogout }),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  default: () => <div data-testid="design-chat-slot" />,
}));

jest.mock('../api/client', () => ({
  designApi: { me: jest.fn(), listProjects: jest.fn(), getProject: jest.fn() },
}));

const api = designApi as unknown as Record<'me' | 'listProjects' | 'getProject', jest.Mock>;

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const project: DesignProject = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 's', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

const error = (status: number, code: string) => new DesignApiError({ status, code });

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/design" element={<DesignHomePage />} />
          <Route path="/design/systems" element={<DesignSystemsPage />} />
          <Route path="/design/:projectId" element={<DesignWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Design home', () => {
  it('shows a loading state while access is checked', () => {
    api.me.mockReturnValue(new Promise(() => undefined));
    renderAt('/design');
    expect(screen.getByRole('heading', { level: 1, name: 'Design' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your access to Etus Design');
  });

  it('tells people without the design permission to ask the hub', async () => {
    api.me.mockResolvedValue({ ...me, permissions: ['media.image'] });
    renderAt('/design');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have access to Etus Design. Ask the hub administrators',
    );
    expect(api.listProjects).not.toHaveBeenCalled();
  });

  it('shows the same message when the hub refuses the exchange', async () => {
    api.me.mockRejectedValue(error(403, 'design_not_allowed'));
    renderAt('/design');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You do not have access to Etus Design',
    );
  });

  it('offers to sign in again when the session expired', async () => {
    api.me.mockRejectedValue(error(401, 'reauth_required'));
    renderAt('/design');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session expired. Sign in again',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(mockLogout).toHaveBeenCalledWith('/login');
  });

  it('lets the person retry when the hub is down', async () => {
    api.me.mockRejectedValueOnce(error(503, 'hub_unavailable')).mockResolvedValue(me);
    api.listProjects.mockResolvedValue({ items: [], nextCursor: null });
    renderAt('/design');
    expect(await screen.findByRole('alert')).toHaveTextContent('The hub is down right now');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('You have no projects yet. Start from a template'),
    ).toBeVisible();
  });

  it('shows the empty state when the person has no projects', async () => {
    api.me.mockResolvedValue(me);
    api.listProjects.mockResolvedValue({ items: [], nextCursor: null });
    renderAt('/design');
    expect(
      await screen.findByText('You have no projects yet. Start from a template'),
    ).toBeVisible();
    expect(api.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'mine', limit: 48 }),
      expect.anything(),
    );
  });

  it('shows an error with retry when projects fail to load', async () => {
    api.me.mockResolvedValue(me);
    api.listProjects
      .mockRejectedValueOnce(error(400, 'invalid_cursor'))
      .mockResolvedValue({ items: [project], nextCursor: null });
    renderAt('/design');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your projects could not be loaded.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Landing Produto X/ })).toHaveAttribute(
      'href',
      '/design/prj_abc',
    );
  });
});

describe('Design workspace placeholder', () => {
  it('opens a project the person can read', async () => {
    api.me.mockResolvedValue(me);
    api.getProject.mockResolvedValue({ ...project, files: [] });
    renderAt('/design/prj_abc');
    expect(await screen.findByRole('heading', { name: 'Landing Produto X' })).toBeVisible();
    expect(api.getProject).toHaveBeenCalledWith('prj_abc', expect.anything());
    expect(screen.getByRole('link', { name: 'Back to Design' })).toHaveAttribute('href', '/design');
  });

  it('says when the project does not exist', async () => {
    api.me.mockResolvedValue(me);
    api.getProject.mockRejectedValue(error(404, 'not_found'));
    renderAt('/design/prj_missing');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This project does not exist or you do not have access to it.',
    );
  });

  it('does not load the project without access', async () => {
    api.me.mockRejectedValue(error(404, 'design_disabled'));
    renderAt('/design/prj_abc');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(api.getProject).not.toHaveBeenCalled();
  });
});

describe('Design systems placeholder', () => {
  it('is gated by the same access check', async () => {
    api.me.mockRejectedValue(error(503, 'hub_unavailable'));
    renderAt('/design/systems');
    expect(await screen.findByRole('alert')).toHaveTextContent('The hub is down right now');
  });
});
