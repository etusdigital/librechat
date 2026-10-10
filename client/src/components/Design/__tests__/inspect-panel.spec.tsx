import userEvent from '@testing-library/user-event';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { FrameMessage, HostCommand, InspectPatch } from '../preview/host-protocol';
import type { DesignMe, DesignProjectDetail, DesignSystemDetail } from '../api/types';
import type { PreviewBridge } from '../preview/use-preview-bridge';
import { previewGeometry } from '../workspace/preview-geometry';
import InspectPanel from '../workspace/inspect/InspectPanel';
import { buildHostMessage } from '../preview/host-protocol';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    getDesignSystem: jest.fn(),
  },
}));

const api = designApi as unknown as Record<'readFile' | 'writeFile' | 'getDesignSystem', jest.Mock>;

const NONCE = 'n'.repeat(24);
const SHA_1 = '1'.repeat(64);
const SHA_2 = '2'.repeat(64);
const H1 = 'body > main:nth-of-type(1) > h1:nth-of-type(1)';
const CTA = '#cta';

const page = (extra = '') => `<!doctype html>
<html><head><title>Landing</title></head>
<body>
<main>
  <h1>Landing Produto X</h1>
  <p>Para <strong>pequenas</strong> empresas</p>
  <button id="cta" style="padding: 8px">Começar</button>${extra}
</main>
</body></html>
`;

const me: DesignMe = {
  sub: 's',
  name: 'Ana',
  orgId: 'org_1',
  permissions: ['projects.use'],
  defaultDesignSystem: 'etus',
};

const projectWith = (sha: string, canWrite = true): DesignProjectDetail => ({
  projectId: 'prj_abc',
  name: 'Landing',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 's', name: 'Ana' },
  access: 'owner',
  canWrite,
  createdAt: null,
  updatedAt: null,
  files: [
    {
      path: 'index.html',
      mime: 'text/html',
      size: 10,
      sha256: sha,
      version: 3,
      updatedAt: null,
      updatedBy: 's',
    },
  ],
});

const designSystem = {
  id: 'etus',
  name: 'Etus',
  colors: [
    { name: 'accent', cssVar: '--accent', value: '#3be476' },
    { name: 'fg', cssVar: '--fg', value: '#151514' },
  ],
  typography: {
    families: [],
    weights: [400, 700],
    scale: [{ name: 'text-3xl', cssVar: '--text-3xl', value: '48px' }],
    leading: [],
    tracking: [],
  },
  tokensCss: ':root { --space-4: 16px; --radius-md: 12px; }',
} as unknown as DesignSystemDetail;

function fileContent(source: string, sha: string, version: number) {
  return { blob: new Blob([source]), mime: 'text/html', etag: `"${sha}"`, version };
}

type Listener = (message: FrameMessage) => void;

function fakeBridge(override?: () => InspectPatch[] | null) {
  const listeners = new Set<Listener>();
  const emit = (message: FrameMessage) => listeners.forEach((listener) => listener(message));
  const sent: HostCommand[] = [];
  const live = new Map<string, InspectPatch>();
  const framePatches =
    override ??
    (() => [...live.values()].map((patch) => ({ ...patch, styles: { ...patch.styles } })));
  const record = (command: HostCommand) => {
    if (command.type === 'etus:inspect-reset') {
      live.clear();
    } else if (command.type === 'etus:inspect-set') {
      const current = live.get(command.selector) ?? { selector: command.selector };
      live.set(command.selector, {
        ...current,
        ...(command.text === undefined ? {} : { text: command.text }),
        ...(command.styles ? { styles: { ...current.styles, ...command.styles } } : {}),
      });
    }
  };
  const bridge: PreviewBridge = {
    frameRef: { current: null },
    nonce: NONCE,
    src: 'https://chat.test/preview/p/tok/index.html',
    loadId: 0,
    ready: { type: 'etus:ready', nonce: NONCE, title: 'Landing', docHeight: 900 },
    lastError: null,
    send: jest.fn((command: HostCommand) => {
      buildHostMessage(command, NONCE);
      sent.push(command);
      record(command);
      if (command.type === 'etus:inspect-extract') {
        const patches = framePatches();
        if (patches) {
          Promise.resolve().then(() =>
            emit({ type: 'etus:inspect-patches', nonce: NONCE, patches }),
          );
        }
      }
      return true;
    }),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload: jest.fn(),
  };
  return { bridge, sent, emit: (message: FrameMessage) => act(() => emit(message)) };
}

const target = (selector: string, textSnippet: string, tag = 'h1'): FrameMessage => ({
  type: 'etus:target',
  nonce: NONCE,
  selector,
  textSnippet,
  rect: { x: 0, y: 0, w: 100, h: 40 },
  tag,
  computed: {
    color: 'rgb(21, 21, 20)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: '32px',
    fontWeight: '700',
    textAlign: 'start',
    margin: '0px',
    padding: '0px',
    borderRadius: '0px',
  },
});

function setup({
  project = projectWith(SHA_1),
  framePatches,
}: { project?: DesignProjectDetail; framePatches?: () => InspectPatch[] | null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createStore();
  const fake = fakeBridge(framePatches);
  const props = {
    project,
    me,
    path: 'index.html',
    device: 'desktop' as const,
    geometry: previewGeometry('desktop', 1, { width: 800, height: 600 }),
    bridge: fake.bridge,
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <InspectPanel {...props} />
      </JotaiProvider>
    </QueryClientProvider>,
  );
  const rerender = (next: Partial<typeof props>) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <InspectPanel {...props} {...next} />
        </JotaiProvider>
      </QueryClientProvider>,
    );
  return { ...fake, rerender, props };
}

async function selectHeading(emit: (message: FrameMessage) => void, snippet = 'Landing Produto X') {
  emit(target(H1, snippet));
  return screen.findByRole('textbox', { name: 'Element text' });
}

function writtenSource(call = 0) {
  return api.writeFile.mock.calls[call][1].content as string;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getDesignSystem.mockResolvedValue(designSystem);
  api.readFile.mockResolvedValue(fileContent(page(), SHA_1, 3));
  api.writeFile.mockResolvedValue({ path: 'index.html', version: 4, sha256: SHA_2, size: 10 });
});

describe('InspectPanel', () => {
  it('asks to pick an element first', () => {
    setup();
    expect(screen.getByText(/Click an element in the preview/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('C-4: edits text and color live and saves an inline_edit version with the expected HTML', async () => {
    const user = userEvent.setup();
    const { emit, sent, bridge } = setup({
      framePatches: () => [
        { selector: H1, text: 'Landing nova', styles: { color: 'var(--accent, #3be476)' } },
      ],
    });
    const text = await selectHeading(emit);
    expect(text).toHaveValue('Landing Produto X');
    await user.clear(text);
    await user.type(text, 'Landing nova');
    expect(sent).toContainEqual({ type: 'etus:inspect-set', selector: H1, text: 'Landing nova' });

    await user.click(screen.getAllByText('Design system values (2)')[0]);
    const colorTokens = screen.getByRole('list', {
      name: 'Design system values for Text color',
    });
    await user.click(within(colorTokens).getByRole('button', { name: 'accent' }));
    expect(sent).toContainEqual({
      type: 'etus:inspect-set',
      selector: H1,
      styles: { color: 'var(--accent, #3be476)' },
    });
    expect(screen.getByText('Unsaved changes in 1 element(s)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1));
    expect(sent).toContainEqual({ type: 'etus:inspect-extract' });
    expect(api.writeFile.mock.calls[0][0]).toBe('prj_abc');
    expect(api.writeFile.mock.calls[0][1]).toMatchObject({
      path: 'index.html',
      ifMatch: `"${SHA_1}"`,
      versionSource: 'inline_edit',
      contentType: 'text/html; charset=utf-8',
    });
    expect(writtenSource()).toBe(
      page().replace(
        '<h1>Landing Produto X</h1>',
        '<h1 style="color: var(--accent, #3be476)">Landing nova</h1>',
      ),
    );
    expect(await screen.findByText('Edit saved as version 4')).toBeInTheDocument();
    expect(bridge.reload).toHaveBeenCalled();
  });

  it('applies typed CSS values on Enter and rejects unsafe or unknown values', async () => {
    const user = userEvent.setup();
    const { emit, sent } = setup();
    await selectHeading(emit);
    const size = screen.getByRole('textbox', { name: 'Font size' });
    expect(size).toHaveAttribute('placeholder', '32px');
    await user.type(size, '48px{Enter}');
    expect(sent).toContainEqual({
      type: 'etus:inspect-set',
      selector: H1,
      styles: { 'font-size': '48px' },
    });
    const background = screen.getByRole('textbox', { name: 'Background color' });
    await user.type(background, 'url(https://evil.test/x.png){Enter}');
    expect(background).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Value not accepted/)).toBeInTheDocument();
    await user.clear(background);
    await user.type(background, 'red; position: fixed{Enter}');
    expect(background).toHaveAttribute('aria-invalid', 'true');
    expect(
      sent.filter(
        (command) => command.type === 'etus:inspect-set' && command.styles?.['background-color'],
      ),
    ).toEqual([]);
  });

  it('writes only what the host sent, whatever the preview reports back', async () => {
    const user = userEvent.setup();
    const { emit } = setup({
      framePatches: (): InspectPatch[] => [
        { selector: H1, text: 'Novo', styles: { color: 'red', 'background-color': 'black' } },
        { selector: 'body > main:nth-of-type(1) > p:nth-of-type(1)', text: 'injected' },
        { selector: CTA, styles: { opacity: '0' } },
      ],
    });
    const text = await selectHeading(emit);
    await user.clear(text);
    await user.type(text, 'Novo');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1));
    expect(writtenSource()).toBe(page().replace('Landing Produto X', 'Novo'));
  });

  it('saves the host edits when the preview does not answer in time', async () => {
    const user = userEvent.setup();
    const { emit } = setup({ framePatches: () => null });
    const text = await selectHeading(emit);
    await user.clear(text);
    await user.type(text, 'Sem resposta');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(writtenSource()).toBe(page().replace('Landing Produto X', 'Sem resposta'));
  });

  it('escapes markup typed as text before writing the file', async () => {
    const user = userEvent.setup();
    const { emit } = setup();
    const text = await selectHeading(emit);
    await user.clear(text);
    await user.type(text, '<img src=x onerror=alert(1)>');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1));
    expect(writtenSource()).toContain('<h1>&lt;img src=x onerror=alert(1)&gt;</h1>');
  });

  it('C-4: a conflict offers reload or applying again over the new version', async () => {
    const user = userEvent.setup();
    const { emit, sent, bridge } = setup();
    const text = await selectHeading(emit);
    await user.clear(text);
    await user.type(text, 'Landing nova');
    api.writeFile.mockRejectedValueOnce(
      new DesignApiError({ status: 412, code: 'precondition_failed' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByTestId('inspect-conflict');
    expect(within(alert).getByText('The file changed while you were editing')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    const agentVersion = page('\n  <footer>Feito pelo agente</footer>');
    api.readFile.mockResolvedValue(fileContent(agentVersion, SHA_2, 4));
    api.writeFile.mockResolvedValueOnce({
      path: 'index.html',
      version: 5,
      sha256: '3'.repeat(64),
      size: 1,
    });
    await user.click(within(alert).getByRole('button', { name: 'Apply again on the new version' }));
    await waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(2));
    expect(api.writeFile.mock.calls[1][1]).toMatchObject({
      ifMatch: `"${SHA_2}"`,
      versionSource: 'inline_edit',
    });
    expect(writtenSource(1)).toBe(agentVersion.replace('Landing Produto X', 'Landing nova'));
    await waitFor(() => expect(screen.queryByTestId('inspect-conflict')).toBeNull());
    expect(bridge.reload).toHaveBeenCalled();
    expect(sent.filter((command) => command.type === 'etus:inspect-reset')).toEqual([]);
  });

  it('reloading from a conflict drops the edits and loads the new version', async () => {
    const user = userEvent.setup();
    const { emit, sent, bridge } = setup();
    const text = await selectHeading(emit);
    await user.type(text, '!');
    api.writeFile.mockRejectedValueOnce(
      new DesignApiError({ status: 412, code: 'precondition_failed' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(sent).toContainEqual({ type: 'etus:inspect-reset' });
    expect(bridge.reload).toHaveBeenCalled();
    expect(screen.queryByTestId('inspect-conflict')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the conflict as soon as the agent changes the file being edited', async () => {
    const user = userEvent.setup();
    const { emit, rerender } = setup();
    const text = await selectHeading(emit);
    await user.type(text, '!');
    expect(screen.queryByTestId('inspect-conflict')).toBeNull();
    rerender({ project: projectWith(SHA_2) });
    expect(screen.getByTestId('inspect-conflict')).toBeInTheDocument();
  });

  it('refuses to apply over a new version where the element changed', async () => {
    const user = userEvent.setup();
    const { emit } = setup();
    const text = await selectHeading(emit);
    await user.type(text, '!');
    api.writeFile.mockRejectedValueOnce(
      new DesignApiError({ status: 412, code: 'precondition_failed' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    api.readFile.mockResolvedValue(
      fileContent(page().replace('Landing Produto X', 'Outro título'), SHA_2, 4),
    );
    await user.click(await screen.findByRole('button', { name: 'Apply again on the new version' }));
    expect(await screen.findByText(/no longer the same in the file/)).toBeInTheDocument();
    expect(api.writeFile).toHaveBeenCalledTimes(1);
  });

  it('re-applies unsaved edits when the preview reloads', async () => {
    const user = userEvent.setup();
    const { emit, sent, rerender, bridge } = setup();
    const text = await selectHeading(emit);
    await user.clear(text);
    await user.type(text, 'Novo');
    sent.length = 0;
    rerender({
      bridge: { ...bridge, ready: { type: 'etus:ready', nonce: NONCE, title: 'x', docHeight: 1 } },
    });
    expect(sent).toEqual([
      { type: 'etus:inspect-set', selector: H1, text: 'Novo' },
      { type: 'etus:highlight', selector: H1 },
    ]);
  });

  it('discards live edits after confirmation', async () => {
    const user = userEvent.setup();
    const { emit, sent } = setup();
    const text = await selectHeading(emit);
    await user.type(text, '!');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(sent).toContainEqual({ type: 'etus:inspect-reset' });
    expect(screen.getByRole('textbox', { name: 'Element text' })).toHaveValue('Landing Produto X');
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('does not edit text of elements with nested markup', async () => {
    const { emit } = setup();
    emit(target('body > main:nth-of-type(1) > p:nth-of-type(1)', 'Para pequenas empresas', 'p'));
    expect(await screen.findByText(/has other elements inside/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Element text' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Text color' })).toBeEnabled();
  });

  it('treats a target from the preview as untrusted data', async () => {
    const { emit } = setup();
    emit(target('*', '<img src=x onerror=alert(1)>', 'div'));
    expect(await screen.findByText(/does not match the file's code/)).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    emit(target(H1, 'Texto trocado por script'));
    expect(await screen.findByText(/changes after the page loads/)).toBeInTheDocument();
  });

  it('keeps read-only projects from editing', async () => {
    const { emit } = setup({ project: projectWith(SHA_1, false) });
    const text = await selectHeading(emit);
    expect(screen.getByText(/You can only view this project/)).toBeInTheDocument();
    expect(text).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Text color' })).toBeDisabled();
  });

  it('shows the inline styles of the source as values', async () => {
    const { emit } = setup();
    emit(target(CTA, 'Começar', 'button'));
    expect(await screen.findByRole('textbox', { name: 'Padding' })).toHaveValue('8px');
  });
});
