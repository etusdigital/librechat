import axe from 'axe-core';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { airbnb, detail, etus, me, minimal, project } from '../systems/__fixtures__/design-systems';
import DesignSystemDetailPage from '../systems/DesignSystemDetailPage';
import { COMPONENTS_SANDBOX } from '../systems/ComponentsPreview';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: true, user: { id: 'u1' }, logout: jest.fn() }),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('copy-to-clipboard', () => jest.fn());

jest.mock('../api/client', () => ({
  designApi: {
    me: jest.fn(),
    getDesignSystem: jest.fn(),
    getProject: jest.fn(),
    updateProject: jest.fn(),
    setCompanyDefaultDesignSystem: jest.fn(),
  },
}));

type ApiName =
  | 'me'
  | 'getDesignSystem'
  | 'getProject'
  | 'updateProject'
  | 'setCompanyDefaultDesignSystem';
const api = designApi as unknown as Record<ApiName, jest.Mock>;

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderDetail(path = '/design/systems/airbnb') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/design/systems/:systemId" element={<DesignSystemDetailPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByTestId('location');

describe('Design system detail (C-15)', () => {
  it('shows a skeleton while the system loads', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockReturnValue(new Promise(() => undefined));
    renderDetail();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading'));
    expect(screen.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Design systems' })).toHaveAttribute(
      'href',
      '/design/systems',
    );
  });

  it('says when the system does not exist', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockRejectedValue(
      new DesignApiError({ status: 404, code: 'design_system_not_found' }),
    );
    renderDetail('/design/systems/nope');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This design system does not exist or is not available.',
    );
  });

  it('shows an error with retry', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem
      .mockRejectedValueOnce(new DesignApiError({ status: 500, code: 'internal' }))
      .mockResolvedValue(detail(airbnb));
    renderDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This design system could not be opened.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Airbnb' })).toBeVisible();
  });

  it('shows colors with computed contrast, typography, components and rules', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'Airbnb' })).toBeVisible();
    expect(screen.getByText('Inspired by Airbnb')).toBeVisible();
    expect(screen.getByText('License: MIT')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Original source' })).toHaveAttribute(
      'href',
      'https://github.com/example/design-systems',
    );

    const colors = screen.getByRole('region', { name: 'Colors' });
    expect(within(colors).getByText('var(--accent)')).toBeVisible();
    expect(within(colors).getByText('#ff385c')).toBeVisible();
    await userEvent.click(within(colors).getByRole('button', { name: 'Copy #ff385c (accent)' }));
    expect(jest.requireMock('copy-to-clipboard')).toHaveBeenCalledWith('#ff385c');
    expect(within(colors).getByText('fg on bg').parentElement).toHaveTextContent(
      /15\.\d\d:1Passes AA/,
    );
    expect(within(colors).getByText('meta on bg').parentElement).toHaveTextContent(
      'Large text only',
    );
    expect(within(colors).getByText('accent-on on accent')).toBeVisible();
    expect(within(colors).queryByText(/accent-hover on/)).toBeNull();

    const typography = screen.getByRole('region', { name: 'Typography' });
    expect(within(typography).getByText('Cereal')).toBeVisible();
    expect(within(typography).getByText('Weight 600')).toHaveStyle({ fontWeight: 600 });
    expect(within(typography).getByText('var(--text-4xl)')).toBeVisible();

    const frame = screen.getByTitle('Components preview of Airbnb');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', COMPONENTS_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('src', 'http://localhost:3080/preview/ds/airbnb/components.html');

    const rules = screen.getByRole('region', { name: 'Rules' });
    expect(rules.querySelector('details')).not.toHaveAttribute('open');
  });

  it('says when a system has no components preview', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockResolvedValue(detail(minimal));
    renderDetail('/design/systems/minimal');
    expect(await screen.findByText('This system has no components preview')).toBeVisible();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('starts a new project with the system through the home screen', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    renderDetail();
    await userEvent.click(
      await screen.findByRole('link', { name: 'New project with this system' }),
    );
    expect(location()).toHaveTextContent('/design?newProject=1&designSystem=airbnb');
    expect(screen.queryByRole('button', { name: 'Use in this project' })).toBeNull();
  });

  it('uses the system in the project it was opened from and offers to ask the agent', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    api.getProject.mockResolvedValue({ ...project, files: [] });
    api.updateProject.mockResolvedValue({ ...project, designSystemId: 'airbnb' });
    renderDetail('/design/systems/airbnb?project=prj_abc');
    expect(await screen.findByRole('link', { name: 'Back to Design systems' })).toHaveAttribute(
      'href',
      '/design/systems?project=prj_abc',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Use in this project' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Use Airbnb in the project Landing Produto X?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use in this project' }));
    expect(api.updateProject).toHaveBeenCalledWith('prj_abc', { designSystemId: 'airbnb' });
    expect(
      await within(dialog).findByText(
        'Airbnb is now the design system of the project Landing Produto X.',
      ),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Ask the agent to apply it' }),
    );
    expect(location()).toHaveTextContent('/design/prj_abc?applyDesignSystem=airbnb');
  });

  it('tells when the project already uses the system or cannot be edited', async () => {
    api.me.mockResolvedValue(me);
    api.getDesignSystem.mockResolvedValue(detail(etus));
    api.getProject.mockResolvedValue({ ...project, files: [] });
    const { unmount } = renderDetail('/design/systems/etus?project=prj_abc');
    expect(await screen.findByText('In use in this project')).toBeVisible();
    unmount();

    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    api.getProject.mockResolvedValue({ ...project, canWrite: false, access: 'shared', files: [] });
    renderDetail('/design/systems/airbnb?project=prj_abc');
    expect(
      await screen.findByText('You can view the project Landing Produto X, but not edit it.'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use in this project' })).toBeNull();
  });
});

describe('Use as company default (C-16)', () => {
  it('is hidden without design-systems.set-default', async () => {
    api.me.mockResolvedValue({ ...me, canSetCompanyDefault: false });
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: 'Airbnb' });
    expect(screen.queryByRole('button', { name: 'Use as default' })).toBeNull();
  });

  it('confirms, saves through the service and shows the company default badge', async () => {
    api.me
      .mockResolvedValueOnce({
        ...me,
        permissions: ['projects.use', 'design-systems.set-default'],
        canSetCompanyDefault: true,
      })
      .mockResolvedValue({
        ...me,
        permissions: ['projects.use', 'design-systems.set-default'],
        canSetCompanyDefault: true,
        companyDefaultDesignSystem: 'airbnb',
      });
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    api.setCompanyDefaultDesignSystem.mockResolvedValue({
      designSystemId: 'airbnb',
      organizationId: 'org_1',
    });
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Use as default' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Use Airbnb as the company default?');
    expect(dialog).toHaveTextContent(
      'Everyone in the company starts projects with Airbnb. Profiles and teams with their own default in the hub keep theirs.',
    );
    expect(api.setCompanyDefaultDesignSystem).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Use as default' }));
    expect(api.setCompanyDefaultDesignSystem).toHaveBeenCalledWith('airbnb');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Company default')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use as default' })).toBeNull();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open with the reason when the hub refuses', async () => {
    api.me.mockResolvedValue({ ...me, canSetCompanyDefault: true });
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    api.setCompanyDefaultDesignSystem.mockRejectedValue(
      new DesignApiError({ status: 403, code: 'permission_required' }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Use as default' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use as default' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You are not allowed to change the company default.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is not offered for the system that already is the company default', async () => {
    api.me.mockResolvedValue({ ...me, canSetCompanyDefault: true });
    api.getDesignSystem.mockResolvedValue(detail(etus));
    renderDetail('/design/systems/etus');
    await screen.findByRole('heading', { level: 1, name: 'Etus' });
    expect(screen.getByText('Company default')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Use as default' })).toBeNull();
  });
});

describe('Design system detail accessibility', () => {
  it('has no serious or critical axe violations', async () => {
    api.me.mockResolvedValue({ ...me, canSetCompanyDefault: true });
    api.getDesignSystem.mockResolvedValue(detail(airbnb));
    api.getProject.mockResolvedValue({ ...project, files: [] });
    const { container } = renderDetail('/design/systems/airbnb?project=prj_abc');
    await screen.findByRole('button', { name: 'Use in this project' });
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});
