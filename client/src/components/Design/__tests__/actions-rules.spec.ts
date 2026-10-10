import { exportDeviceOf, exportOptionsFor, safeDownloadUrl } from '../workspace/export/options';
import { compareLines, isComparableText, versionAuthor } from '../workspace/versions/compare';
import { actionErrorMessageKey, jobErrorMessageKey } from '../workspace/actions/errors';
import { sharePermissionsOf } from '../workspace/share/share-rules';
import { DesignApiError } from '../api/errors';

describe('version comparison', () => {
  it('counts lines added and removed regardless of order of unchanged lines', () => {
    expect(compareLines('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
    expect(compareLines('a\nb\nc', 'a\nx\nc\ny')).toEqual({ added: 2, removed: 1 });
    expect(compareLines('', 'a\nb')).toEqual({ added: 2, removed: 0 });
    expect(compareLines('a\r\nb', 'a\nb')).toEqual({ added: 0, removed: 0 });
    expect(compareLines('a\na', 'a')).toEqual({ added: 0, removed: 1 });
  });

  it('compares only small text files', () => {
    expect(isComparableText({ mime: 'text/html', size: 100 })).toBe(true);
    expect(isComparableText({ mime: 'image/svg+xml', size: 100 })).toBe(true);
    expect(isComparableText({ mime: 'image/png', size: 100 })).toBe(false);
    expect(isComparableText({ mime: 'text/html', size: 10 * 1024 * 1024 })).toBe(false);
  });

  it('names who made a version without exposing ids', () => {
    const project = { owner: { sub: 'owner', name: 'Ana' } };
    expect(versionAuthor({ actorSub: 'me' }, { sub: 'me' }, project)).toEqual({
      key: 'actions.version_author_you',
    });
    expect(versionAuthor({ actorSub: 'owner' }, { sub: 'me' }, project)).toEqual({ name: 'Ana' });
    expect(versionAuthor({ actorSub: 'x' }, { sub: 'me' }, project)).toEqual({
      key: 'actions.version_author_other',
    });
  });
});

describe('export options', () => {
  const ids = (options: ReturnType<typeof exportOptionsFor>) =>
    Object.fromEntries(options.map((option) => [option.id, option.disabledReasonKey]));

  it('offers every format, with PPTX disabled and explained without the permission', () => {
    const options = exportOptionsFor({
      permissions: ['projects.use'],
      path: 'index.html',
      device: 'mobile',
    });
    expect(ids(options)).toEqual({
      pdf: null,
      pdf_image: null,
      png: null,
      html: null,
      zip: null,
      md: null,
      pptx_image: 'actions.export_reason_pptx_permission',
      pptx_editable: 'actions.export_reason_pptx_permission',
    });
    const png = options.find((option) => option.id === 'png');
    expect(png?.request).toEqual({
      format: 'png',
      path: 'index.html',
      options: { device: 'mobile' },
    });
    expect(options.find((option) => option.id === 'zip')?.request).toEqual({ format: 'zip' });
  });

  it('enables both PPTX modes with the permission', () => {
    const options = exportOptionsFor({
      permissions: ['projects.use', 'exports.pptx'],
      path: 'deck.html',
      device: 'free',
    });
    expect(options.find((option) => option.id === 'pptx_image')?.request).toEqual({
      format: 'pptx',
      path: 'deck.html',
      options: { pptxMode: 'image' },
    });
    expect(options.find((option) => option.id === 'pptx_editable')).toMatchObject({
      disabledReasonKey: null,
      beta: true,
      request: { options: { pptxMode: 'editable' } },
    });
    expect(options.find((option) => option.id === 'png')?.request.options).toEqual({
      device: 'desktop',
    });
  });

  it('explains why page formats do not apply to the open file', () => {
    expect(
      ids(exportOptionsFor({ permissions: [], path: 'notes.md', device: null })),
    ).toMatchObject({ pdf: 'actions.export_reason_html_only', md: null, zip: null });
    expect(
      ids(exportOptionsFor({ permissions: [], path: 'logo.png', device: null })),
    ).toMatchObject({
      html: 'actions.export_reason_html_only',
      md: 'actions.export_reason_md_only',
      zip: null,
    });
    expect(ids(exportOptionsFor({ permissions: [], path: null, device: null }))).toMatchObject({
      pdf: 'actions.export_reason_open_html',
      zip: null,
    });
    expect(exportDeviceOf('tablet')).toBe('tablet');
  });

  it('only follows http download links', () => {
    expect(safeDownloadUrl('/preview/d/abc', 'https://chat-ai.etus.io')).toBe(
      'https://chat-ai.etus.io/preview/d/abc',
    );
    expect(safeDownloadUrl('javascript:alert(1)', 'https://chat-ai.etus.io')).toBeNull();
    expect(safeDownloadUrl(null, 'https://chat-ai.etus.io')).toBeNull();
  });
});

describe('share rules', () => {
  it('mirrors the design-service: write access plus a share permission', () => {
    expect(
      sharePermissionsOf({ canWrite: false }, { permissions: ['projects.share-public'] }),
    ).toMatchObject({ canManage: false, reasonKey: 'actions.share_reason_read_only' });
    expect(sharePermissionsOf({ canWrite: true }, { permissions: ['projects.use'] })).toMatchObject(
      {
        canManage: false,
        reasonKey: 'actions.share_reason_no_permission',
      },
    );
    expect(
      sharePermissionsOf({ canWrite: true }, { permissions: ['projects.share-public'] }),
    ).toEqual({ canManage: true, canShareCompany: false, canSharePublic: true, reasonKey: null });
  });
});

describe('action errors', () => {
  it('maps service codes to texts of the actions block', () => {
    expect(
      actionErrorMessageKey(
        new DesignApiError({ status: 403, code: 'export_pptx_forbidden' }),
        'actions.share_error',
      ),
    ).toBe('actions.export_reason_pptx_permission');
    expect(
      actionErrorMessageKey(
        new DesignApiError({ status: 503, code: 'hub_unavailable' }),
        'actions.share_error',
      ),
    ).toBe('error_hub_unavailable');
    expect(
      actionErrorMessageKey(
        new DesignApiError({ status: 400, code: 'weird' }),
        'actions.share_error',
      ),
    ).toBe('actions.share_error');
    expect(jobErrorMessageKey('export_no_slides')).toBe('actions.error_export_no_slides');
    expect(jobErrorMessageKey({ nope: true })).toBe('actions.error_export_failed');
  });
});
