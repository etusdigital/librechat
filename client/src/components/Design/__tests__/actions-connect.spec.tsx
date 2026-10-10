import copy from 'copy-to-clipboard';
import { request } from 'librechat-data-provider';
import { Provider as JotaiProvider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignProject } from '../api/types';
import { DesignProjectActions, ConnectAgentDialog } from '../workspace/actions';
import { designActionsApi } from '../api/actions';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: () => '',
    request: { ...actual.request, authenticatedFetch: jest.fn() },
  };
});

jest.mock('copy-to-clipboard', () => ({ __esModule: true, default: jest.fn(() => true) }));

const authenticatedFetch = request.authenticatedFetch as jest.Mock;
const fetchSpy = jest.fn();

const project: DesignProject = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 'owner', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: null,
  updatedAt: null,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <JotaiProvider>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </JotaiProvider>,
  );
}

const requestedUrls = () => [
  ...authenticatedFetch.mock.calls.map(([url]) => String(url)),
  ...fetchSpy.mock.calls.map(([url]) => String(url)),
];

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchSpy as unknown as typeof fetch;
  authenticatedFetch.mockImplementation(async (url: string) =>
    url.endsWith('/me')
      ? jsonResponse(200, {
          sub: 'owner',
          name: 'Ana',
          orgId: 'org_1',
          permissions: ['projects.use'],
          defaultDesignSystem: 'etus',
        })
      : jsonResponse(404, { error: { code: 'not_found' } }),
  );
});

describe('ConnectAgentDialog', () => {
  it('explains the hub connection and links to it without calling any route', async () => {
    renderWithProviders(<ConnectAgentDialog open onOpenChange={jest.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Connect agents' });
    expect(dialog).toHaveTextContent('Connect https://apps.etus.io/mcp once');
    expect(dialog).toHaveTextContent('No token is created here.');
    expect(
      screen.getByDisplayValue('claude mcp add --transport http etus https://apps.etus.io/mcp'),
    ).toBeVisible();

    const hub = screen.getByRole('link', { name: /Open in the hub/ });
    expect(hub).toHaveAttribute('href', 'https://apps.etus.io/connect-agents');
    expect(hub).toHaveAttribute('target', '_blank');
    expect(hub).toHaveAttribute('rel', 'noopener noreferrer');

    await userEvent.click(within(dialog).getByRole('button', { name: /Copy Claude Code command/ }));
    expect(copy).toHaveBeenCalledWith(
      'claude mcp add --transport http etus https://apps.etus.io/mcp',
    );
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    expect(authenticatedFetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('DesignProjectActions', () => {
  it('renders the header actions and opens Connect agents from the menu without any token route', async () => {
    renderWithProviders(<DesignProjectActions project={project} />);

    expect(screen.getByRole('button', { name: 'Versions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();

    const callsBefore = requestedUrls().length;
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Connect agents' }));

    expect(await screen.findByRole('dialog', { name: 'Connect agents' })).toBeInTheDocument();
    expect(requestedUrls()).toHaveLength(callsBefore);
    expect(requestedUrls().some((url) => /token/i.test(url))).toBe(false);
  });

  it('adds the menu items the workspace header passes in', async () => {
    const onDuplicate = jest.fn();
    renderWithProviders(
      <DesignProjectActions
        project={project}
        menuItems={[{ id: 'duplicate', label: 'Duplicate', onClick: onDuplicate }]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(onDuplicate).toHaveBeenCalled();
  });

  it('uses the open tab as the file of the versions dialog', async () => {
    renderWithProviders(<DesignProjectActions project={project} activePath="about.html" />);
    await userEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Versions' });
    expect(dialog).toHaveTextContent('about.html');
    expect(
      authenticatedFetch.mock.calls.some(([url]) =>
        String(url).includes('/api/etus/design/projects/prj_abc/files/versions?path=about.html'),
      ),
    ).toBe(true);
  });
});

describe('design actions API', () => {
  it('sends exports, shares and revocations to the proxy', async () => {
    authenticatedFetch.mockResolvedValue(jsonResponse(202, { jobId: 'job_1' }));
    await designActionsApi.exportProject('prj_abc', {
      format: 'pptx',
      path: 'deck.html',
      options: { pptxMode: 'editable' },
    });
    expect(authenticatedFetch).toHaveBeenLastCalledWith(
      '/api/etus/design/projects/prj_abc/exports',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          format: 'pptx',
          path: 'deck.html',
          options: { pptxMode: 'editable' },
        }),
      }),
    );

    authenticatedFetch.mockResolvedValue(jsonResponse(201, { shareId: 'shr_1' }));
    await designActionsApi.createShare('prj_abc', { kind: 'public', expiresInDays: 7 });
    expect(authenticatedFetch).toHaveBeenLastCalledWith(
      '/api/etus/design/projects/prj_abc/shares',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'public', expiresInDays: 7 }),
      }),
    );

    authenticatedFetch.mockResolvedValue({ ...jsonResponse(204, null), status: 204, ok: true });
    await designActionsApi.revokeShare('shr_1');
    expect(authenticatedFetch).toHaveBeenLastCalledWith(
      '/api/etus/design/shares/shr_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
