import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import type { DesignJob, DesignReview, ReviewOutcome } from '../api/types';
import type { FrameMessage } from '../preview/host-protocol';
import {
  mockStageSize,
  mockViewport,
  panelProject,
  readyFrame,
  renderPanelsWorkspace,
  restoreStageSize,
  viewer,
} from '../__fixtures__/workspace-panels';
import { workspaceApi } from '../api/workspace';
import { DesignApiError } from '../api/errors';
import { designApi } from '../api/client';
import { reviewApi } from '../api/review';
import { planApi } from '../api/plan';

const mockSendMessage = jest.fn();
const mockInsertIntoComposer = jest.fn();

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
  useLastAssistantMessage: () => null,
  useDesignChatActions: () => ({
    insertIntoComposer: mockInsertIntoComposer,
    sendMessage: mockSendMessage,
  }),
}));

jest.mock('../chat/DesignChatSlot', () => ({
  __esModule: true,
  default: () => <div data-testid="design-chat-slot" />,
}));

jest.mock('../api/client', () => ({
  ...jest.requireActual('../api/client'),
  designApi: { listFiles: jest.fn(), getDesignSystem: jest.fn(), getJob: jest.fn() },
}));

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn(), previewUrl: jest.fn() },
}));

jest.mock('../api/plan', () => ({
  ...jest.requireActual('../api/plan'),
  planApi: { get: jest.fn() },
}));

jest.mock('../api/review', () => ({
  ...jest.requireActual('../api/review'),
  reviewApi: { request: jest.fn() },
}));

const api = designApi as unknown as Record<string, jest.Mock>;
const ws = workspaceApi as unknown as Record<string, jest.Mock>;
const plans = planApi as unknown as Record<string, jest.Mock>;
const reviews = reviewApi as unknown as Record<string, jest.Mock>;

const JURY = viewer(['projects.use', 'review.jury']);

function review(overrides: Partial<DesignReview> = {}): DesignReview {
  return {
    reviewId: 'rev_1',
    jobId: 'job_1',
    projectId: 'prj_abc',
    path: 'index.html',
    round: 1,
    maxRounds: 2,
    model: 'cc/claude-sonnet-5',
    scores: { visual: 7.5, brand: 8.5, accessibility: 6, copy: 8 },
    weightedScore: 7.4,
    threshold: 8,
    ship: false,
    mustFix: [
      {
        dimension: 'accessibility',
        severity: 'critical',
        source: 'axe',
        rule: 'color-contrast',
        issue: 'Elements must meet minimum color contrast ratio thresholds',
        where: 'section.hero a.cta',
        fix: 'Use --etus-grey-950 no texto sobre --etus-green',
      },
      {
        dimension: 'copy',
        severity: 'major',
        source: 'judge',
        issue: 'Generic headline',
        where: 'the hero headline',
        fix: 'Say what the product does',
      },
    ],
    niceToHave: [{ dimension: 'visual', issue: 'Uneven spacing', fix: 'Use the spacing scale' }],
    summary: 'Solid base with contrast problems.',
    facts: {
      axeViolations: 1,
      horizontalScrollAt390: false,
      consoleErrors: 0,
      fontsLoaded: ['Space Grotesk'],
      violations: [
        {
          rule: 'color-contrast',
          impact: 'serious',
          help: 'contrast',
          nodeCount: 1,
          targets: ['section.hero a.cta'],
          summary: '',
          devices: ['mobile'],
        },
      ],
    },
    screenshots: [
      {
        device: 'mobile',
        part: 1,
        parts: 1,
        width: 1170,
        height: 2532,
        url: 'https://chat.test/preview/d/shot-mobile.png',
      },
      { device: 'desktop', part: 1, parts: 1, width: 1440, height: 900, url: null },
    ],
    costUsd: 0.03,
    ...overrides,
  };
}

function job(overrides: Partial<DesignJob> = {}): DesignJob {
  return {
    jobId: 'job_1',
    type: 'review',
    projectId: 'prj_abc',
    status: 'running',
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

const succeeded = (value: DesignReview = review()): ReviewOutcome => ({
  status: 'succeeded',
  ...value,
});

beforeAll(() => mockStageSize());
afterAll(() => restoreStageSize());

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  mockViewport(false);
  mockSendMessage.mockResolvedValue(true);
  mockInsertIntoComposer.mockResolvedValue(true);
  api.listFiles.mockResolvedValue({ items: panelProject.files });
  api.getDesignSystem.mockResolvedValue({ id: 'etus', name: 'Etus' });
  plans.get.mockResolvedValue({ plan: null });
  ws.listChanges.mockResolvedValue({ items: [], paths: [], projectUpdatedAt: 'p', until: 'u' });
  ws.previewUrl.mockResolvedValue({
    url: 'https://chat.test/preview/p/tok/index.html',
    expiresAt: '2999-01-01T00:00:00.000Z',
  });
});

const juryButton = () => screen.findByRole('button', { name: 'Review with the jury' });
const juryPanel = () => screen.getByTestId('jury-panel');

describe('jury access', () => {
  it('hides the jury from people without review.jury', async () => {
    renderPanelsWorkspace({ me: viewer(['projects.use']) });
    await screen.findByTestId('design-plan-button');
    expect(screen.queryByTestId('design-jury-button')).not.toBeInTheDocument();
  });

  it('keeps the jury out of the compact menu without review.jury', async () => {
    mockViewport(true);
    renderPanelsWorkspace({ me: viewer(['projects.use']) });
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Review with the jury' })).toBeNull();
  });
});

describe('jury panel', () => {
  it('reviews the active page and shows the scores, items and facts', async () => {
    reviews.request.mockResolvedValue(succeeded());
    renderPanelsWorkspace({ me: JURY });

    const button = await juryButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);

    expect(reviews.request).toHaveBeenCalledWith('prj_abc', { path: 'index.html' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'design-jury-panel');
    expect(await screen.findByTestId('jury-score')).toHaveTextContent('7.4');
    expect(screen.getByTestId('jury-verdict')).toHaveTextContent('Below the minimum score of 8.0');
    expect(screen.getByTestId('jury-dimension-accessibility')).toHaveTextContent(
      'Accessibility6.0',
    );
    expect(screen.getByTestId('jury-dimension-brand')).toHaveTextContent('Brand8.5');
    expect(screen.getByText('Round 1 of 2 this hour')).toBeInTheDocument();

    const mustFix = screen.getByTestId('jury-must-fix');
    expect(within(mustFix).getByRole('heading', { name: 'To fix (2)' })).toBeInTheDocument();
    expect(within(mustFix).getAllByTestId('jury-finding')).toHaveLength(2);
    expect(within(mustFix).getByText('Critical')).toBeInTheDocument();
    expect(within(mustFix).getAllByRole('button', { name: 'Show in preview' })).toHaveLength(1);
    expect(
      within(screen.getByTestId('jury-nice-to-have')).getByRole('heading', {
        name: 'Suggestions (1)',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Space Grotesk')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Screenshot on Mobile, part 1 of 1' })).toHaveAttribute(
      'src',
      'https://chat.test/preview/d/shot-mobile.png',
    );
    expect(screen.getByText('Cost of this review: $0.03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review again' })).toBeEnabled();
    expect(window.sessionStorage.getItem('etus-design:jury:prj_abc')).toBe(
      JSON.stringify({ jobId: 'job_1', path: 'index.html' }),
    );
  });

  it('shows the running job and polls it until the review is ready', async () => {
    reviews.request.mockResolvedValue({
      status: 'running',
      jobId: 'job_1',
      reviewId: 'rev_1',
      projectId: 'prj_abc',
    });
    api.getJob.mockResolvedValueOnce(job());
    api.getJob.mockResolvedValue(job({ status: 'succeeded', output: { ...review() } }));
    renderPanelsWorkspace({ me: JURY });

    await userEvent.click(await juryButton());
    expect(await screen.findByTestId('jury-running')).toHaveTextContent(
      'The jury is reviewing index.html. This takes about 1 minute.',
    );
    expect(screen.getByTestId('jury-review')).toBeDisabled();
    expect(await screen.findByTestId('jury-score', {}, { timeout: 5000 })).toHaveTextContent('7.4');
    expect(api.getJob).toHaveBeenCalledWith('job_1', expect.anything());
  });

  it('resumes a review stored for the tab after a reload', async () => {
    window.sessionStorage.setItem(
      'etus-design:jury:prj_abc',
      JSON.stringify({ jobId: 'job_9', path: 'index.html' }),
    );
    api.getJob.mockResolvedValue(
      job({ jobId: 'job_9', status: 'succeeded', output: { ...review({ jobId: 'job_9' }) } }),
    );
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    expect(await screen.findByTestId('jury-score')).toHaveTextContent('7.4');
    expect(reviews.request).not.toHaveBeenCalled();
  });

  it('highlights the item in the preview and switches to the device where axe found it', async () => {
    reviews.request.mockResolvedValue(succeeded());
    renderPanelsWorkspace({ me: JURY });
    const { postMessage } = await readyFrame();
    await userEvent.click(await juryButton());
    await screen.findByTestId('jury-score');

    await userEvent.click(screen.getByRole('button', { name: 'Show in preview' }));

    await waitFor(() =>
      expect(postMessage.mock.calls.map(([message]) => message as FrameMessage)).toContainEqual(
        expect.objectContaining({ type: 'etus:highlight', selector: 'section.hero a.cta' }),
      ),
    );
    expect(screen.getByRole('button', { name: /^Mobile/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the items to fix to the project conversation', async () => {
    reviews.request.mockResolvedValue(succeeded());
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    await screen.findByTestId('jury-score');

    await userEvent.click(screen.getByRole('button', { name: 'Ask the agent for fixes' }));

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(mockSendMessage.mock.calls[0][0]).toBe(
      [
        'Fix the file index.html according to the jury review (score 7.4 out of 10, round 1 of 2):',
        '1. Accessibility, critical [section.hero a.cta]: Elements must meet minimum color contrast ratio thresholds. How to fix: Use --etus-grey-950 no texto sobre --etus-green.',
        '2. Copy [the hero headline]: Generic headline. How to fix: Say what the product does.',
        'When you are done, ask the jury for a new review and tell me the new score and what is left as a suggestion.',
      ].join('\n'),
    );
    expect(await screen.findByText('Request sent to the agent.')).toBeInTheDocument();
    expect(mockInsertIntoComposer).not.toHaveBeenCalled();
  });

  it('puts the request in the composer when the agent is busy', async () => {
    mockSendMessage.mockResolvedValue(false);
    reviews.request.mockResolvedValue(succeeded(review({ round: 2 })));
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    await screen.findByTestId('jury-score');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the agent for fixes' }));
    await waitFor(() => expect(mockInsertIntoComposer).toHaveBeenCalledTimes(1));
    expect(mockInsertIntoComposer.mock.calls[0][0]).toMatch(
      /When you are done, tell me what changed\. The jury review limit/,
    );
    expect(await screen.findByText('The request is in the chat. Check it and send.')).toBeVisible();
  });

  it('hides the request for fixes from read only viewers', async () => {
    reviews.request.mockResolvedValue(succeeded());
    renderPanelsWorkspace({ me: JURY, project: { ...panelProject, canWrite: false } });
    await userEvent.click(await juryButton());
    await screen.findByTestId('jury-score');
    expect(screen.queryByRole('button', { name: 'Ask the agent for fixes' })).toBeNull();
  });

  it('shows the best review when the round limit is reached', async () => {
    reviews.request.mockResolvedValue({
      status: 'round_limit',
      projectId: 'prj_abc',
      path: 'index.html',
      maxRounds: 2,
      best: review({ weightedScore: 8.3, ship: true, round: 2 }),
    });
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    expect(await screen.findByTestId('jury-round-limit')).toHaveTextContent(
      'index.html already went through the jury 2 times this hour. Try again later.',
    );
    expect(screen.getByText('Below is the best review of this hour.')).toBeInTheDocument();
    expect(screen.getByTestId('jury-score')).toHaveTextContent('8.3');
    expect(screen.getByTestId('jury-verdict')).toHaveTextContent('Ready to ship');
    expect(screen.getByTestId('jury-review')).toBeDisabled();
  });

  it('explains a failed review and lets the person try again', async () => {
    reviews.request.mockRejectedValueOnce(
      new DesignApiError({ status: 502, code: 'jury_invalid_output' }),
    );
    reviews.request.mockResolvedValueOnce(succeeded());
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The jury did not return a valid review, even after a retry.',
    );
    await userEvent.click(within(juryPanel()).getByRole('button', { name: 'Review index.html' }));
    expect(await screen.findByTestId('jury-score')).toHaveTextContent('7.4');
  });

  it('reports a job that failed after it started', async () => {
    reviews.request.mockResolvedValue({
      status: 'running',
      jobId: 'job_1',
      reviewId: 'rev_1',
      projectId: 'prj_abc',
    });
    api.getJob.mockResolvedValue(job({ status: 'failed', error: 'jury_timeout' }));
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await juryButton());
    expect(await screen.findByTestId('jury-error')).toHaveTextContent(
      'The jury review took too long and was stopped. Try again.',
    );
    expect(window.sessionStorage.getItem('etus-design:jury:prj_abc')).toBeNull();
  });

  it('opens from the compact menu and stacks under the preview', async () => {
    mockViewport(true);
    reviews.request.mockResolvedValue(succeeded());
    renderPanelsWorkspace({ me: JURY });
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Review with the jury' }));
    expect(await screen.findByTestId('jury-score')).toBeInTheDocument();
    expect(screen.getByTestId('design-side-panel')).toHaveAttribute('data-layout', 'stacked');
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  });
});
