import { request } from 'librechat-data-provider';
import userEvent from '@testing-library/user-event';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesignPlan, DesignReview } from '../api/types';
import {
  buildJuryChatRequest,
  highlightDevice,
  isCssSelector,
  juryErrorMessageKey,
} from '../workspace/jury/jury-request';
import {
  isJuryStep,
  readStoredJury,
  reviewPathOf,
  shownReviewOf,
  storeJury,
} from '../workspace/jury/jury-state';
import { planChanges, planProgress } from '../workspace/plan/plan-progress';
import { planAnnouncementKey } from '../workspace/plan/use-plan-activity';
import { DESIGN_NAMESPACE, type DesignTranslationKey } from '../i18n';
import NextStepChips from '../workspace/next-steps/NextStepChips';
import { JuryProvider } from '../workspace/jury/use-jury';
import { workspacePanelAtom } from '../state/atoms';
import { DesignApiError } from '../api/errors';
import { reviewApi } from '../api/review';
import i18n from '~/locales/i18n';

const mockChat = {
  sendMessage: jest.fn<Promise<boolean>, [string]>(),
  insertIntoComposer: jest.fn<Promise<boolean>, [string, File[]?]>(),
  lastText: null as string | null,
};

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => false,
  useLastAssistantMessage: () => (mockChat.lastText ? { text: mockChat.lastText } : null),
  useDesignChatActions: () => ({
    sendMessage: mockChat.sendMessage,
    insertIntoComposer: mockChat.insertIntoComposer,
  }),
}));

const ptBR = (key: DesignTranslationKey, options?: Record<string, unknown>) =>
  (i18n.t as unknown as (k: string, o: Record<string, unknown>) => string)(key, {
    ...options,
    lng: 'pt-BR',
    ns: DESIGN_NAMESPACE,
  });

const baseReview: DesignReview = {
  reviewId: 'rev_1',
  jobId: 'job_1',
  projectId: 'prj_abc',
  path: 'index.html',
  round: 1,
  maxRounds: 2,
  model: 'm',
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
      issue: 'Botão principal com contraste 2.9:1',
      where: 'section.hero a.cta',
      fix: 'Use --etus-grey-950 no texto sobre --etus-green',
    },
    {
      dimension: 'copy',
      severity: 'major',
      source: 'judge',
      issue: 'Título genérico.',
      fix: 'Diga o que o produto faz.',
    },
  ],
  niceToHave: [],
  summary: null,
  facts: {
    axeViolations: 1,
    horizontalScrollAt390: false,
    consoleErrors: 0,
    fontsLoaded: [],
    violations: [
      {
        rule: 'color-contrast',
        impact: 'serious',
        help: '',
        nodeCount: 1,
        targets: ['section.hero a.cta'],
        summary: '',
        devices: ['mobile', 'tablet'],
      },
    ],
  },
  screenshots: [],
  costUsd: null,
};

describe('jury chat request', () => {
  it('lists the items to fix in pt-BR, without dashes', () => {
    const text = buildJuryChatRequest({ review: baseReview, localize: ptBR, locale: 'pt-BR' });
    expect(text).toBe(
      [
        'Corrija o arquivo index.html conforme a revisão do júri (nota 7,4 de 10, rodada 1 de 2):',
        '1. Acessibilidade, crítico [section.hero a.cta]: Botão principal com contraste 2.9:1. Como corrigir: Use --etus-grey-950 no texto sobre --etus-green.',
        '2. Texto: Título genérico. Como corrigir: Diga o que o produto faz.',
        'Ao terminar, peça uma nova revisão do júri e me diga a nota nova e o que ficou como sugestão.',
      ].join('\n'),
    );
    expect(text).not.toMatch(/[–—]/);
  });

  it('does not ask for another review after the last round', () => {
    const text = buildJuryChatRequest({
      review: { ...baseReview, round: 2 },
      localize: ptBR,
      locale: 'pt-BR',
    });
    expect(text.split('\n').pop()).toBe(
      'Ao terminar, me diga o que mudou. O limite de revisões do júri para este arquivo nesta hora já foi usado.',
    );
  });
});

describe('jury helpers', () => {
  it('recognizes the next step that asks for the jury', () => {
    expect(isJuryStep('Revisar com o júri')).toBe(true);
    expect(isJuryStep('  revisar com o JURI para checar contraste')).toBe(true);
    expect(isJuryStep('Revisar com juri')).toBe(true);
    expect(isJuryStep('Revisar o texto')).toBe(false);
    expect(isJuryStep('Exportar em PDF')).toBe(false);
  });

  it('reviews the active page or falls back to the entry page', () => {
    const files = [
      { path: 'index.html', mime: 'text/html' },
      { path: 'about.html', mime: 'text/html' },
      { path: 'styles.css', mime: 'text/css' },
    ];
    expect(reviewPathOf(files, 'about.html', 'index.html')).toBe('about.html');
    expect(reviewPathOf(files, 'styles.css', 'index.html')).toBe('index.html');
    expect(reviewPathOf([files[2]], 'styles.css', 'styles.css')).toBeNull();
  });

  it('only offers to show selectors that the preview can find', () => {
    expect(isCssSelector('section.hero a.cta')).toBe(true);
    expect(isCssSelector('footer a:nth-of-type(2)')).toBe(true);
    expect(isCssSelector('h1')).toBe(true);
    expect(isCssSelector('header nav a')).toBe(true);
    expect(isCssSelector('the hero headline')).toBe(false);
    expect(isCssSelector('a[')).toBe(false);
    expect(isCssSelector('')).toBe(false);
    expect(isCssSelector(undefined)).toBe(false);
  });

  it('moves to a device where axe saw the problem', () => {
    const [axe, judge] = baseReview.mustFix;
    expect(highlightDevice(axe, baseReview.facts, 'desktop')).toBe('mobile');
    expect(highlightDevice(axe, baseReview.facts, 'tablet')).toBeNull();
    expect(highlightDevice(judge, baseReview.facts, 'desktop')).toBeNull();
  });

  it('maps the service errors to messages', () => {
    expect(juryErrorMessageKey('round_limit')).toBe('jury.error_generic');
    expect(juryErrorMessageKey('jury_invalid_output')).toBe('jury.error_invalid_output');
    expect(juryErrorMessageKey('render_timeout')).toBe('jury.error_render');
    expect(juryErrorMessageKey('retry_needed')).toBe('jury.error_interrupted');
    expect(
      juryErrorMessageKey(
        'hub_unavailable',
        new DesignApiError({ status: 503, code: 'hub_unavailable' }),
      ),
    ).toBe('error_hub_unavailable');
  });

  it('keeps the last review of the project in the tab storage', () => {
    storeJury('prj_1', { jobId: 'job_1', path: 'index.html' });
    expect(readStoredJury('prj_1')).toEqual({ jobId: 'job_1', path: 'index.html' });
    storeJury('prj_1', null);
    expect(readStoredJury('prj_1')).toBeNull();
    window.sessionStorage.setItem('etus-design:jury:prj_2', '{broken');
    expect(readStoredJury('prj_2')).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    expect(readStoredJury('prj_3', throwing)).toBeNull();
    expect(() => storeJury('prj_3', { jobId: 'j', path: 'p' }, throwing)).not.toThrow();
  });

  it('shows the best review on the round limit', () => {
    expect(
      shownReviewOf({ status: 'round_limit', path: 'index.html', maxRounds: 2, best: baseReview }),
    ).toBe(baseReview);
    expect(shownReviewOf({ status: 'running', path: 'index.html', jobId: 'job_1' })).toBeNull();
  });
});

describe('review request', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(request, 'authenticatedFetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  const reply = (status: number, body: unknown) => {
    const response = {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      clone: () => response,
    };
    return response as unknown as Response;
  };

  it('posts the path to the project reviews', async () => {
    fetchSpy.mockResolvedValueOnce(reply(201, { status: 'succeeded', ...baseReview }));
    const outcome = await reviewApi.request('prj_abc', { path: 'index.html' });
    expect(outcome.status).toBe('succeeded');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/etus\/design\/projects\/prj_abc\/reviews$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ path: 'index.html' }) });
  });

  it('turns the 429 round_limit into the best review', async () => {
    fetchSpy.mockResolvedValueOnce(
      reply(429, {
        error: { code: 'round_limit', message: 'limite', maxRounds: 2 },
        review: baseReview,
      }),
    );
    expect(await reviewApi.request('prj_abc', { path: 'index.html' })).toEqual({
      status: 'round_limit',
      projectId: 'prj_abc',
      path: 'index.html',
      maxRounds: 2,
      best: baseReview,
    });
  });

  it('keeps other 429 answers as errors', async () => {
    fetchSpy.mockResolvedValueOnce(reply(429, { error: { code: 'router_limit' } }));
    await expect(reviewApi.request('prj_abc', { path: 'index.html' })).rejects.toMatchObject({
      status: 429,
      code: 'router_limit',
    });
  });
});

describe('plan progress', () => {
  const plan: DesignPlan = {
    planId: 'pln_1',
    projectId: 'prj_abc',
    conversationId: null,
    taskType: 'deck',
    direction: { name: 'Editorial', summary: '' },
    items: [
      { id: 'i1', title: 'Capa', status: 'done', note: null },
      { id: 'i2', title: 'Agenda', status: 'skipped', note: null },
      { id: 'i3', title: 'Resultados', status: 'pending', note: null },
    ],
    frozenAt: null,
    createdAt: null,
    updatedAt: null,
  };

  it('counts done and skipped steps as finished', () => {
    expect(planProgress(plan)).toMatchObject({
      total: 3,
      finished: 2,
      done: 1,
      skipped: 1,
      complete: false,
      current: plan.items[2],
    });
    expect(planProgress(null)).toBeNull();
  });

  it('finds the steps that changed and what to announce', () => {
    const next = {
      ...plan,
      items: [plan.items[0], plan.items[1], { ...plan.items[2], status: 'done' as const }],
    };
    expect(planChanges(plan, next).map(({ item }) => item.id)).toEqual(['i3']);
    expect(planChanges(plan, { ...next, planId: 'pln_2' })).toEqual([]);
    expect(planAnnouncementKey(plan, next)).toEqual({
      key: 'plan.announce_done',
      options: { title: 'Resultados' },
    });
    expect(planAnnouncementKey(null, plan)).toEqual({
      key: 'plan.announce_new',
      options: { count: 3 },
    });
    expect(planAnnouncementKey(plan, plan)).toBeNull();
  });
});

describe('next step "Revisar com o júri"', () => {
  let requestSpy: jest.SpyInstance;

  function PanelProbe() {
    return <span data-testid="panel">{useAtomValue(workspacePanelAtom) ?? 'none'}</span>;
  }

  function renderChips(enabled: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <JotaiProvider>
          <JuryProvider projectId="prj_abc" enabled={enabled} reviewPath="index.html">
            <NextStepChips conversationId="conv-1" />
            <PanelProbe />
          </JuryProvider>
        </JotaiProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    requestSpy = jest
      .spyOn(reviewApi, 'request')
      .mockResolvedValue({ status: 'succeeded', ...baseReview });
    mockChat.sendMessage.mockReset().mockResolvedValue(true);
    mockChat.insertIntoComposer.mockReset().mockResolvedValue(true);
    mockChat.lastText = [
      '## Próximos passos',
      '1. Revisar com o júri',
      '2. Exportar em PDF',
      '3. Trocar a cor do botão',
    ].join('\n');
    window.sessionStorage.clear();
  });

  afterEach(() => requestSpy.mockRestore());

  it('starts the review on the screen for people with the jury', async () => {
    renderChips(true);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar com o júri' }));
    await waitFor(() => expect(requestSpy).toHaveBeenCalledWith('prj_abc', { path: 'index.html' }));
    expect(screen.getByTestId('panel')).toHaveTextContent('jury');
    expect(mockChat.sendMessage).not.toHaveBeenCalled();
  });

  it('sends the text to the agent for people without the jury', async () => {
    renderChips(false);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar com o júri' }));
    expect(mockChat.sendMessage).toHaveBeenCalledWith('Revisar com o júri');
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
