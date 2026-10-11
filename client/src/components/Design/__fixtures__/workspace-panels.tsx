import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { Provider as JotaiProvider } from 'jotai';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import { DesignWorkspace } from '../workspace/DesignWorkspacePage';

export const indexFile: FileEntry = {
  path: 'index.html',
  mime: 'text/html',
  size: 10,
  sha256: 'sha',
  version: 4,
  updatedAt: null,
  updatedBy: 'ana',
};

export const cssFile: FileEntry = { ...indexFile, path: 'styles.css', mime: 'text/css' };

export const panelProject: DesignProjectDetail = {
  projectId: 'prj_abc',
  name: 'Landing Produto X',
  kind: 'prototype',
  designSystemId: 'etus',
  entryFile: 'index.html',
  templateId: null,
  tags: [],
  owner: { sub: 'ana', name: 'Ana' },
  access: 'owner',
  canWrite: true,
  createdAt: null,
  updatedAt: null,
  files: [indexFile, cssFile],
};

export function viewer(permissions: DesignMe['permissions']): DesignMe {
  return { sub: 'ana', name: 'Ana', orgId: 'org_1', permissions, defaultDesignSystem: 'etus' };
}

export function mockViewport(compact: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width') ? compact : !compact,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

const STAGE = 'design-preview-stage';
let restoreSizes: (() => void) | null = null;

export function mockStageSize(width = 1000, height = 800) {
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.dataset?.testid === STAGE ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.dataset?.testid === STAGE ? height : 0;
    },
  });
  restoreSizes = () => {
    if (originalWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
    }
    if (originalHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight);
    }
  };
}

export function restoreStageSize() {
  restoreSizes?.();
  restoreSizes = null;
}

export function renderPanelsWorkspace({
  me,
  project = panelProject,
}: {
  me: DesignMe;
  project?: DesignProjectDetail;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  const view = render(
    <RecoilRoot>
      <QueryClientProvider client={client}>
        <JotaiProvider>
          <MemoryRouter initialEntries={['/design/prj_abc']}>
            <DesignWorkspace project={project} me={me} />
          </MemoryRouter>
        </JotaiProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );
  return { ...view, client };
}

export async function readyFrame() {
  const frame = (await screen.findByTitle('Preview of index.html')) as HTMLIFrameElement;
  const nonce = new URL(frame.getAttribute('src') ?? '').searchParams.get('bridge') ?? '';
  const postMessage = jest.spyOn(frame.contentWindow as Window, 'postMessage');
  const event = new MessageEvent('message', {
    data: { type: 'etus:ready', title: 'Landing', docHeight: 1200, nonce },
    origin: 'null',
  });
  Object.defineProperty(event, 'source', { value: frame.contentWindow });
  act(() => {
    window.dispatchEvent(event);
  });
  return { frame, postMessage };
}
