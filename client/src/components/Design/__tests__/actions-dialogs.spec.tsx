import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignJob, DesignMe, DesignProject, DesignShare, FileVersion } from '../api/types';
import VersionHistoryDialog from '../workspace/versions/VersionHistoryDialog';
import { startDownload } from '../workspace/export/download';
import ShareDialog from '../workspace/share/ShareDialog';
import ExportMenu from '../workspace/export/ExportMenu';
import { designActionsApi } from '../api/actions';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('../api/client', () => ({
  designApi: { me: jest.fn(), listVersions: jest.fn(), listShares: jest.fn(), getJob: jest.fn() },
}));

jest.mock('../api/actions', () => ({
  designActionsApi: {
    restoreVersion: jest.fn(),
    exportProject: jest.fn(),
    createShare: jest.fn(),
    revokeShare: jest.fn(),
    versionPreviewUrl: jest.fn(),
    readVersionText: jest.fn(),
  },
}));

jest.mock('../workspace/export/download', () => ({ startDownload: jest.fn() }));
jest.mock('copy-to-clipboard', () => ({ __esModule: true, default: jest.fn(() => true) }));

const api = designApi as unknown as Record<
  'me' | 'listVersions' | 'listShares' | 'getJob',
  jest.Mock
>;
const actions = designActionsApi as unknown as Record<keyof typeof designActionsApi, jest.Mock>;
const download = startDownload as jest.Mock;

const me: DesignMe = {
  sub: 'owner',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use', 'projects.share-company', 'projects.share-public'],
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
  owner: { sub: 'owner', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

function version(number: number, overrides: Partial<FileVersion> = {}): FileVersion {
  return {
    versionId: `ver_${number}`,
    path: 'index.html',
    version: number,
    sha256: `sha${number}`,
    size: 100 * number,
    mime: 'text/html',
    source: 'agent',
    actorSub: 'owner',
    via: 'chat',
    conversationId: null,
    note: null,
    createdAt: `2026-10-0${number}T10:00:00.000Z`,
    ...overrides,
  };
}

function job(overrides: Partial<DesignJob> = {}): DesignJob {
  return {
    jobId: 'job_1',
    type: 'export',
    projectId: 'prj_abc',
    status: 'queued',
    output: null,
    error: null,
    costUsd: null,
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    downloadUrl: null,
    downloads: [],
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.me.mockResolvedValue(me);
  actions.versionPreviewUrl.mockResolvedValue({
    url: 'https://chat-ai.etus.io/preview/p/token/index.html',
    expiresAt: '2026-10-10T12:00:00.000Z',
  });
  actions.readVersionText.mockImplementation(async (_projectId, input: { version: number }) =>
    input.version === 3 ? '<h1>Novo</h1>\n<p>Texto</p>' : '<h1>Antigo</h1>\n<p>Texto</p>',
  );
});

describe('VersionHistoryDialog (C-7)', () => {
  it('restores an old version as a new one, after confirmation', async () => {
    const history = [version(3), version(2, { source: 'inline_edit' }), version(1)];
    api.listVersions.mockResolvedValueOnce({ items: history }).mockResolvedValue({
      items: [
        version(4, { source: 'restore', note: 'Restaurada da versão 1', sha256: 'sha1' }),
        ...history,
      ],
    });
    actions.restoreVersion.mockResolvedValue({ path: 'index.html', version: 4 });

    renderWithClient(
      <VersionHistoryDialog project={project} path="index.html" open onOpenChange={jest.fn()} />,
    );

    const list = await screen.findByRole('list', { name: 'File versions' });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(within(list).getByRole('button', { name: /Version 2 · Edit/ })).toBeInTheDocument();
    expect(screen.getByText('Current version')).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: /Version 1 · Agent/ }));
    expect(await screen.findByTitle('Preview of version 1')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-popups',
    );
    expect(
      await screen.findByText(
        '1 lines the current one does not have and 1 lines of the current one this one does not have.',
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    const confirm = await screen.findByRole('dialog', { name: 'Restore version 1?' });
    expect(confirm).toHaveTextContent('The content of version 1 becomes version 4.');
    expect(actions.restoreVersion).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Restore this version' }));

    expect(actions.restoreVersion).toHaveBeenCalledWith('prj_abc', {
      path: 'index.html',
      version: 1,
    });
    const restored = await screen.findByRole('button', { name: /Version 4 · Restore/ });
    expect(restored).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByText('Restaurada da versão 1').length).toBeGreaterThan(0);
  });

  it('does not offer to restore on a read-only project', async () => {
    api.listVersions.mockResolvedValue({ items: [version(2), version(1)] });
    renderWithClient(
      <VersionHistoryDialog
        project={{ ...project, canWrite: false, access: 'shared' }}
        path="index.html"
        open
        onOpenChange={jest.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Version 1/ }));
    expect(
      screen.getByText('Only people who can edit the project restore versions.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
  });

  it('asks to open a file when nothing is active', () => {
    renderWithClient(
      <VersionHistoryDialog project={project} path={null} open onOpenChange={jest.fn()} />,
    );
    expect(screen.getAllByText('Open a file to see its versions.').length).toBeGreaterThan(0);
    expect(api.listVersions).not.toHaveBeenCalled();
  });
});

describe('ExportMenu (C-8)', () => {
  function renderExport(permissions = me.permissions, path: string | null = 'index.html') {
    api.me.mockResolvedValue({ ...me, permissions });
    return renderWithClient(
      <ExportMenu project={project} path={path} device="mobile" open onOpenChange={jest.fn()} />,
    );
  }

  it('exports a PDF, follows the job and downloads the file', async () => {
    actions.exportProject.mockResolvedValue(job());
    api.getJob.mockResolvedValue(
      job({
        status: 'succeeded',
        downloadUrl: '/preview/d/abc/landing.pdf',
        downloads: [{ fileName: 'landing.pdf', url: '/preview/d/abc/landing.pdf', expiresAt: 'x' }],
      }),
    );
    renderExport();

    await userEvent.click(await screen.findByRole('button', { name: /^PDF Selectable text/ }));
    expect(actions.exportProject).toHaveBeenCalledWith('prj_abc', {
      format: 'pdf',
      path: 'index.html',
      options: { pdfMode: 'vector' },
    });
    expect(await screen.findByText('PDF ready. The download started.')).toBeInTheDocument();
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(
      `${window.location.origin}/preview/d/abc/landing.pdf`,
      'landing.pdf',
    );
    expect(screen.getByRole('link', { name: 'Download again' })).toHaveAttribute(
      'href',
      `${window.location.origin}/preview/d/abc/landing.pdf`,
    );
  });

  it('exports the whole project as ZIP', async () => {
    actions.exportProject.mockResolvedValue(job({ jobId: 'job_zip' }));
    api.getJob.mockResolvedValue(
      job({
        jobId: 'job_zip',
        status: 'succeeded',
        downloads: [{ fileName: 'landing.zip', url: '/preview/d/zip/landing.zip' }],
      }),
    );
    renderExport();
    await userEvent.click(await screen.findByRole('button', { name: /^ZIP/ }));
    expect(actions.exportProject).toHaveBeenCalledWith('prj_abc', { format: 'zip' });
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        `${window.location.origin}/preview/d/zip/landing.zip`,
        'landing.zip',
      ),
    );
  });

  it('shows the progress while the job runs', async () => {
    actions.exportProject.mockResolvedValue(job());
    api.getJob.mockResolvedValue(job({ status: 'running' }));
    renderExport();
    await userEvent.click(
      await screen.findByRole('button', { name: /^PNG of the current device/ }),
    );
    expect(actions.exportProject).toHaveBeenCalledWith('prj_abc', {
      format: 'png',
      path: 'index.html',
      options: { device: 'mobile' },
    });
    expect(
      await screen.findByText('PNG of the current device: generating the file.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /^ZIP/ })).toBeDisabled();
    expect(download).not.toHaveBeenCalled();
  });

  it('keeps PPTX disabled with the reason when the person lacks the permission', async () => {
    renderExport(['projects.use']);
    for (const name of [/^PPTX as images/, /^Editable PPTX/]) {
      const button = await screen.findByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(
        'Your account is not allowed to export PPTX. Ask the hub administrators',
      );
    }
  });

  it('offers image or editable PPTX with the permission', async () => {
    actions.exportProject.mockResolvedValue(job());
    api.getJob.mockResolvedValue(job({ status: 'failed', error: 'export_no_slides' }));
    renderExport([...me.permissions, 'exports.pptx']);
    await userEvent.click(await screen.findByRole('button', { name: /^Editable PPTX/ }));
    expect(actions.exportProject).toHaveBeenCalledWith('prj_abc', {
      format: 'pptx',
      path: 'index.html',
      options: { pptxMode: 'editable' },
    });
    expect(
      await screen.findByText(/This page has no slides\. PPTX is made from a deck/),
    ).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it('explains a refused request', async () => {
    actions.exportProject.mockRejectedValue(
      new DesignApiError({ status: 400, code: 'project_empty' }),
    );
    renderExport();
    await userEvent.click(await screen.findByRole('button', { name: /^ZIP/ }));
    expect(await screen.findByText('The project has no files to export yet.')).toBeInTheDocument();
  });

  it('disables page formats for a file that is not HTML', async () => {
    renderExport(me.permissions, 'styles.css');
    const pdf = await screen.findByRole('button', { name: /^PDF This format/ });
    expect(pdf).toBeDisabled();
    expect(screen.getByRole('button', { name: /^ZIP/ })).toBeEnabled();
  });
});

describe('ShareDialog (C-9)', () => {
  const publicShare: DesignShare = {
    shareId: 'shr_pub',
    projectId: 'prj_abc',
    kind: 'public',
    authUserIds: [],
    expiresAt: '2026-10-24T10:00:00.000Z',
    createdBy: 'owner',
    createdAt: '2026-10-10T10:00:00.000Z',
    revokedAt: null,
  };
  const companyShare: DesignShare = {
    ...publicShare,
    shareId: 'shr_co',
    kind: 'company',
    expiresAt: null,
  };

  function renderShare(overrides: Partial<DesignProject> = {}) {
    const onOpenChange = jest.fn();
    const view = renderWithClient(
      <ShareDialog project={{ ...project, ...overrides }} open onOpenChange={onOpenChange} />,
    );
    return { ...view, onOpenChange };
  }

  it('creates a public link, shows it only once and lets the person revoke it', async () => {
    api.listShares.mockResolvedValueOnce([]).mockResolvedValue([publicShare]);
    actions.createShare.mockResolvedValue({
      ...publicShare,
      url: 'https://chat-ai.etus.io/preview/s/secret-token/',
    });
    actions.revokeShare.mockResolvedValue(undefined);
    const { rerender } = renderShare();

    await userEvent.selectOptions(await screen.findByLabelText('Valid for'), '14');
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(actions.createShare).toHaveBeenCalledWith('prj_abc', {
      kind: 'public',
      expiresInDays: 14,
    });
    expect(
      await screen.findByDisplayValue('https://chat-ai.etus.io/preview/s/secret-token/'),
    ).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('it is shown only this once');

    const active = await screen.findByRole('list', { name: 'Active public links' });
    expect(within(active).getByText(/Valid until/)).toBeInTheDocument();

    rerender(<ShareDialog project={project} open={false} onOpenChange={jest.fn()} />);
    rerender(<ShareDialog project={project} open onOpenChange={jest.fn()} />);
    await screen.findByRole('list', { name: 'Active public links' });
    expect(screen.queryByDisplayValue(/secret-token/)).not.toBeInTheDocument();

    api.listShares.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Public link' }));
    const confirm = await screen.findByRole('dialog', { name: 'Revoke this share?' });
    expect(confirm).toHaveTextContent('Link expired or revoked');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    expect(actions.revokeShare).toHaveBeenCalledWith('shr_pub');
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Active public links' })).not.toBeInTheDocument(),
    );
  });

  it('turns sharing with the whole company on and off', async () => {
    api.listShares.mockResolvedValueOnce([]).mockResolvedValue([companyShare]);
    actions.createShare.mockResolvedValue(companyShare);
    actions.revokeShare.mockResolvedValue(undefined);
    renderShare();

    const toggle = await screen.findByRole('switch', { name: 'Whole company' });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(actions.createShare).toHaveBeenCalledWith('prj_abc', { kind: 'company' });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Whole company' })).toBeChecked(),
    );

    api.listShares.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('switch', { name: 'Whole company' }));
    expect(actions.revokeShare).toHaveBeenCalledWith('shr_co');
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Whole company' })).not.toBeChecked(),
    );
  });

  it('tells the maximum validity the company allows', async () => {
    api.listShares.mockResolvedValue([]);
    actions.createShare.mockRejectedValue(
      new DesignApiError({ status: 400, code: 'share_expiry_too_long', details: { maxDays: 3 } }),
    );
    renderShare();
    await userEvent.selectOptions(await screen.findByLabelText('Valid for'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The company allows public links of at most 3 days.',
    );
  });

  it('explains missing permissions', async () => {
    api.me.mockResolvedValue({ ...me, permissions: ['projects.use', 'projects.share-company'] });
    api.listShares.mockResolvedValue([]);
    renderShare();
    expect(
      await screen.findByText(
        'Your account is not allowed to create public links. Ask the hub administrators',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create link' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Whole company' })).toBeEnabled();
  });

  it('does not list shares of a project the person cannot manage', async () => {
    renderShare({ canWrite: false, access: 'shared' });
    expect(
      await screen.findByText('Only the project owner or an Etus Design administrator can share.'),
    ).toBeInTheDocument();
    expect(api.listShares).not.toHaveBeenCalled();
  });

  it('lists people shares and lets the owner revoke them', async () => {
    api.listShares.mockResolvedValue([
      { ...publicShare, shareId: 'shr_people', kind: 'people', authUserIds: ['a', 'b'] },
    ]);
    renderShare();
    const list = await screen.findByRole('list', { name: 'Shares with people' });
    expect(within(list).getByText('2 people')).toBeInTheDocument();
  });
});
