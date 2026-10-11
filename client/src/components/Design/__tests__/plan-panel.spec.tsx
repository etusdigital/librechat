import userEvent from '@testing-library/user-event';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { DesignPlan, DesignPlanItem } from '../api/types';
import {
  mockStageSize,
  mockViewport,
  panelProject,
  renderPanelsWorkspace,
  restoreStageSize,
  viewer,
} from '../__fixtures__/workspace-panels';
import { planApi, planKeys } from '../api/plan';
import { workspaceApi } from '../api/workspace';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
  useLastAssistantMessage: () => null,
  useDesignChatActions: () => ({ insertIntoComposer: jest.fn(), sendMessage: jest.fn() }),
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  default: () => <div data-testid="design-chat-slot" />,
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: { listFiles: jest.fn(), getDesignSystem: jest.fn(), listComments: jest.fn() },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn(), previewUrl: jest.fn() },
}));

jest.mock('../api/plan', () => ({
  ...jest.requireActual('../api/plan'),
  planApi: { get: jest.fn() },
}));

const api = designApi as unknown as Record<string, jest.Mock>;
const ws = workspaceApi as unknown as Record<string, jest.Mock>;
const plans = planApi as unknown as Record<string, jest.Mock>;

const ME = viewer(['projects.use']);

function item(id: string, title: string, status: DesignPlanItem['status'] = 'pending') {
  return { id, title, status, note: null };
}

function plan(overrides: Partial<DesignPlan> = {}): DesignPlan {
  return {
    planId: 'pln_1',
    projectId: 'prj_abc',
    conversationId: null,
    taskType: 'deck',
    direction: { name: 'Editorial', summary: 'Serif headings and generous spacing.' },
    items: [
      item('i1', 'Cover', 'done'),
      item('i2', 'Agenda', 'in_progress'),
      item('i3', 'Results'),
      item('i4', 'Next steps'),
    ],
    frozenAt: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...overrides,
  };
}

let current: DesignPlan | null = null;

beforeAll(() => mockStageSize());
afterAll(() => restoreStageSize());

beforeEach(() => {
  jest.clearAllMocks();
  current = null;
  mockViewport(false);
  api.listFiles.mockResolvedValue({ items: panelProject.files });
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  api.listComments.mockResolvedValue([]);
  plans.get.mockImplementation(async () => ({ plan: current }));
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
});

const planButton = () => screen.findByTestId('design-plan-button');
const planPanel = () => screen.getByTestId('plan-panel');

async function poll(client: ReturnType<typeof renderPanelsWorkspace>['client']) {
  await act(async () => {
    await client.refetchQueries({ queryKey: planKeys.plan('prj_abc') });
  });
}

describe('plan panel', () => {
  it('explains that there is no plan yet', async () => {
    renderPanelsWorkspace({ me: ME });
    const button = await planButton();
    expect(button).toHaveAccessibleName('Plan');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'design-plan-panel');
    expect(
      await within(planPanel()).findByText(/No plan yet\. When the agent plans this project/),
    ).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Plan' })).toBeInTheDocument();
  });

  it('lists the steps with their status and progress', async () => {
    current = plan();
    renderPanelsWorkspace({ me: ME });
    const button = await planButton();
    await waitFor(() => expect(button).toHaveAccessibleName('Plan, 1 of 4 steps done'));
    expect(within(button).getByText('1/4')).toBeInTheDocument();
    await userEvent.click(button);

    const panel = planPanel();
    expect(await within(panel).findByText('Editorial')).toBeInTheDocument();
    expect(within(panel).getByText('Deck')).toBeInTheDocument();
    expect(within(panel).getByTestId('plan-progress')).toHaveTextContent('1 of 4 steps done');
    expect(within(panel).getByRole('progressbar', { name: 'Plan progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    const steps = within(panel).getAllByTestId('plan-item');
    expect(steps.map((step) => step.getAttribute('data-status'))).toEqual([
      'done',
      'in_progress',
      'pending',
      'pending',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(within(steps[0]).getByText('Done')).toBeInTheDocument();
    expect(within(steps[1]).getByText('In progress')).toBeInTheDocument();
  });

  it('checks the steps off as the agent moves on, without a reload', async () => {
    current = plan();
    const { client } = renderPanelsWorkspace({ me: ME });
    await userEvent.click(await planButton());
    await within(planPanel()).findByText('Editorial');

    current = plan({
      items: [
        item('i1', 'Cover', 'done'),
        item('i2', 'Agenda', 'done'),
        item('i3', 'Results', 'in_progress'),
        item('i4', 'Next steps', 'skipped'),
      ],
    });
    await poll(client);

    await waitFor(() =>
      expect(within(planPanel()).getByTestId('plan-progress')).toHaveTextContent(
        '3 of 4 steps done',
      ),
    );
    const steps = within(planPanel()).getAllByTestId('plan-item');
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(within(steps[3]).getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByTestId('design-plan-announcement')).toHaveTextContent(
      'Step skipped: Next steps',
    );
    expect(screen.getByTestId('design-plan-button')).toHaveAccessibleName(
      'Plan, 3 of 4 steps done',
    );
  });

  it('opens by itself when the agent saves a new plan', async () => {
    const { client } = renderPanelsWorkspace({ me: ME });
    await planButton();
    await waitFor(() => expect(plans.get).toHaveBeenCalled());
    expect(screen.queryByTestId('plan-panel')).toBeNull();

    current = plan();
    await poll(client);

    expect(await screen.findByTestId('plan-panel')).toBeInTheDocument();
    expect(screen.getByTestId('design-plan-announcement')).toHaveTextContent(
      'New plan with 4 steps.',
    );
  });

  it('does not open by itself for a plan that already existed', async () => {
    current = plan();
    renderPanelsWorkspace({ me: ME });
    const button = await planButton();
    await waitFor(() => expect(button).toHaveAccessibleName('Plan, 1 of 4 steps done'));
    expect(screen.queryByTestId('plan-panel')).toBeNull();
  });

  it('shares the side with the preview modes, one panel at a time', async () => {
    current = plan();
    renderPanelsWorkspace({ me: ME });
    await screen.findByTitle('Preview of index.html');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByTestId('comment-panel')).toBeInTheDocument();

    await userEvent.click(await planButton());
    expect(await screen.findByTestId('plan-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-panel')).toBeNull();
    expect(screen.getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByTestId('comment-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-panel')).toBeNull();
  });

  it('closes from its own button', async () => {
    renderPanelsWorkspace({ me: ME });
    await userEvent.click(await planButton());
    await userEvent.click(screen.getByRole('button', { name: 'Close the Plan panel' }));
    expect(screen.queryByTestId('plan-panel')).toBeNull();
    expect(screen.getByTestId('design-plan-button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('design-plan-button')).not.toHaveAttribute('aria-controls');
  });

  it('shows an error with a retry', async () => {
    plans.get.mockRejectedValue(new DesignApiError({ status: 500, code: 'internal_error' }));
    renderPanelsWorkspace({ me: ME });
    await userEvent.click(await planButton());
    expect(await within(planPanel()).findByRole('alert')).toHaveTextContent(
      'Could not load the plan.',
    );
    current = plan();
    plans.get.mockImplementation(async () => ({ plan: current }));
    await userEvent.click(within(planPanel()).getByRole('button', { name: 'Try again' }));
    expect(await within(planPanel()).findByText('Editorial')).toBeInTheDocument();
  });

  it('opens from the compact menu under the preview', async () => {
    mockViewport(true);
    current = plan();
    renderPanelsWorkspace({ me: ME });
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Plan' }));
    expect(await screen.findByTestId('plan-panel')).toBeInTheDocument();
    expect(screen.getByTestId('design-side-panel')).toHaveAttribute('data-layout', 'stacked');
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  });
});
