import type { DesignComment } from '../api/types';
import type { DesignLocalize } from '../i18n';
import {
  CHAT_SNIPPET_MAX,
  buildCommentChatRequest,
  canChangeCommentStatus,
  commentRequestLine,
  commentsForChat,
} from '../workspace/comments/comment-request';
import { COMPOSER_SIZE, composerPlacement } from '../workspace/comments/comment-placement';
import { mergeComment } from '../api/comment-queries';
import { DESIGN_NAMESPACE } from '../i18n';
import i18n from '~/locales/i18n';

const translate = i18n.t.bind(i18n) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

function localizeIn(lng: string): DesignLocalize {
  return ((key: string, options?: Record<string, unknown>) =>
    translate(key, { ...options, lng, ns: DESIGN_NAMESPACE })) as unknown as DesignLocalize;
}

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    commentId: 'cmt_1',
    projectId: 'prj_abc',
    path: 'index.html',
    version: 4,
    anchor: {
      selector: 'section.hero > h1',
      textSnippet: 'Título atual',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      device: 'desktop',
    },
    body: 'deixar mais curto e direto.',
    authorSub: 'ana',
    authorName: 'Ana',
    status: 'open',
    resolvedBy: null,
    resolvedNote: null,
    sentToChatAt: null,
    createdAt: null,
    ...overrides,
  };
}

const footer = comment({
  commentId: 'cmt_2',
  anchor: {
    selector: 'footer a:nth-of-type(2)',
    textSnippet: 'Contato',
    rect: { x: 0, y: 0, w: 10, h: 10 },
    device: 'mobile',
  },
  body: 'trocar por WhatsApp.',
});

describe('chat request from comments (C 3.7)', () => {
  it('matches the format of the spec in pt-BR', () => {
    expect(
      buildCommentChatRequest({
        path: 'index.html',
        version: 4,
        comments: [comment(), footer],
        localize: localizeIn('pt-BR'),
      }),
    ).toBe(
      [
        'Ajuste o arquivo index.html (versão 4) conforme estes comentários:',
        '1. [section.hero > h1] "Título atual": deixar mais curto e direto.',
        '2. [footer a:nth-of-type(2)] "Contato": trocar por WhatsApp.',
        'Ao terminar, marque cada comentário como resolvido.',
      ].join('\n'),
    );
  });

  it('keeps paths with special characters as they are', () => {
    const text = buildCommentChatRequest({
      path: 'pages/a&b <x>.html',
      version: 2,
      comments: [comment()],
      localize: localizeIn('pt-BR'),
    });
    expect(text.split('\n')[0]).toBe(
      'Ajuste o arquivo pages/a&b <x>.html (versão 2) conforme estes comentários:',
    );
  });

  it('keeps each comment in one line and leaves out an empty snippet', () => {
    expect(
      commentRequestLine(
        comment({
          anchor: { ...comment().anchor, textSnippet: '  ', selector: 'div:nth-of-type(3)' },
          body: 'mais\n\nespaço   entre\tblocos',
        }),
        2,
      ),
    ).toBe('3. [div:nth-of-type(3)]: mais espaço entre blocos');
  });

  it('shortens long snippets', () => {
    const line = commentRequestLine(
      comment({ anchor: { ...comment().anchor, textSnippet: 'a'.repeat(200) } }),
      0,
    );
    const snippet = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
    expect(snippet).toHaveLength(CHAT_SNIPPET_MAX);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('comment rules', () => {
  it('lets the author or a project editor change the status', () => {
    const others = comment({ authorSub: 'bia' });
    expect(canChangeCommentStatus(others, { sub: 'ana' }, { canWrite: true })).toBe(true);
    expect(canChangeCommentStatus(others, { sub: 'ana' }, { canWrite: false })).toBe(false);
    expect(canChangeCommentStatus(comment(), { sub: 'ana' }, { canWrite: false })).toBe(true);
  });

  it('selects the open comments not yet sent, unless the person changed it', () => {
    const sent = comment({ commentId: 'cmt_3', sentToChatAt: '2026-10-10T10:00:00.000Z' });
    const resolved = comment({ commentId: 'cmt_4', status: 'resolved' });
    const all = [comment(), footer, sent, resolved];
    expect(commentsForChat(all, {}).map((item) => item.commentId)).toEqual(['cmt_1', 'cmt_2']);
    expect(
      commentsForChat(all, { cmt_1: false, cmt_3: true, cmt_4: true }).map(
        (item) => item.commentId,
      ),
    ).toEqual(['cmt_2', 'cmt_3']);
  });

  it('merges a saved comment into a cached list', () => {
    const updated = comment({ status: 'resolved' });
    expect(mergeComment([comment(), footer], updated)).toEqual([updated, footer]);
    expect(mergeComment([footer], updated)).toEqual([footer, updated]);
  });
});

describe('composer placement', () => {
  const geometry = (scale: number, width = 1440, height = 900) => ({
    viewport: { width, height },
    scale,
    frame: { width: width * scale, height: height * scale },
  });

  it('opens below the target and counters the zoom', () => {
    expect(composerPlacement({ x: 40, y: 100, w: 300, h: 50 }, geometry(0.5))).toEqual({
      left: 40,
      top: 166,
      inverseScale: 2,
    });
  });

  it('opens above the target near the bottom and stays inside the viewport', () => {
    const height = COMPOSER_SIZE.height;
    expect(composerPlacement({ x: 1400, y: 800, w: 30, h: 40 }, geometry(1))).toEqual({
      left: 1440 - COMPOSER_SIZE.width,
      top: 800 - 8 - height,
      inverseScale: 1,
    });
    expect(composerPlacement({ x: -50, y: 10, w: 30, h: 880 }, geometry(1, 1440, 900))).toEqual({
      left: 0,
      top: 900 - height,
      inverseScale: 1,
    });
  });

  it('gives up when the preview is smaller than the composer', () => {
    expect(composerPlacement({ x: 0, y: 0, w: 10, h: 10 }, geometry(0.1))).toBeNull();
    expect(composerPlacement({ x: 0, y: 0, w: 10, h: 10 }, geometry(1, 200, 150))).toBeNull();
  });
});
