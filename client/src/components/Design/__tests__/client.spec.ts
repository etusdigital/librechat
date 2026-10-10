import { request } from 'librechat-data-provider';
import { DesignApiError, designErrorMessageKey, isRetryableDesignError } from '../api/errors';
import { designApi, designPath, designUrl } from '../api/client';
import { retryDesignQuery } from '../api/queries';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: () => '',
    request: { ...actual.request, authenticatedFetch: jest.fn() },
  };
});

const fetchMock = request.authenticatedFetch as jest.Mock;

function fakeResponse(status: number, body: string | null, headers: Record<string, string> = {}) {
  const byName = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => byName.get(name.toLowerCase()) ?? null },
    json: async () => JSON.parse(body ?? ''),
    blob: async () => new Blob([body ?? ''], { type: byName.get('content-type') ?? '' }),
  } as unknown as Response;
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  fakeResponse(status, body === undefined ? null : JSON.stringify(body), {
    'Content-Type': 'application/json',
    ...headers,
  });

describe('design API client', () => {
  it('builds proxy URLs with encoded segments and no empty query values', () => {
    expect(designUrl('projects', { scope: 'mine', query: '', cursor: null, limit: 48 })).toBe(
      '/api/etus/design/projects?scope=mine&limit=48',
    );
    expect(designPath('projects', 'prj_1/../x', 'files')).toBe('projects/prj_1%2F..%2Fx/files');
  });

  it('reads JSON through the request helper of the data provider', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        sub: 's',
        name: 'n',
        orgId: 'o',
        permissions: [],
        defaultDesignSystem: 'etus',
      }),
    );
    await expect(designApi.me()).resolves.toMatchObject({ defaultDesignSystem: 'etus' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/etus/design/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('turns proxy errors into DesignApiError with code and Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        503,
        { error: { code: 'hub_unavailable', message: 'Hub fora do ar' } },
        { 'Retry-After': '5' },
      ),
    );
    const error = await designApi.me().catch((caught) => caught);
    expect(error).toBeInstanceOf(DesignApiError);
    expect(error).toMatchObject({ status: 503, code: 'hub_unavailable', retryAfterSeconds: 5 });
    expect(designErrorMessageKey(error)).toBe('error_hub_unavailable');
  });

  it('falls back to an http code when the body is not the proxy format', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(500, '<html>'));
    await expect(designApi.me()).rejects.toMatchObject({ status: 500, code: 'http_500' });
  });

  it('sends file content as a raw body with the version headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { path: 'index.html', version: 3, sha256: 'abc', size: 4 }),
    );
    await designApi.writeFile('prj_1', {
      path: 'index.html',
      content: '<h1>',
      contentType: 'text/html',
      ifMatch: '"abc"',
      versionSource: 'inline_edit',
      note: 'Título ajustado',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/etus/design/projects/prj_1/files/content?path=index.html');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('<h1>');
    expect(init.headers).toMatchObject({
      'Content-Type': 'text/html',
      'If-Match': '"abc"',
      'X-Etus-Version-Source': 'inline_edit',
      'X-Etus-Note': encodeURIComponent('Título ajustado'),
    });
  });

  it('returns undefined for 204 answers', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, null));
    await expect(designApi.bindConversation('prj_1', 'conv-1')).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ conversationId: 'conv-1' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('reads file content with its version headers', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, '<h1>oi</h1>', {
        'Content-Type': 'text/html',
        ETag: '"sha"',
        'X-Etus-Version': '4',
      }),
    );
    const file = await designApi.readFile('prj_1', { path: 'index.html' });
    expect(file).toMatchObject({ mime: 'text/html', etag: '"sha"', version: 4 });
    expect(file.blob.size).toBe('<h1>oi</h1>'.length);
  });

  it('retries only transient failures', () => {
    const error = (status: number, code: string) => new DesignApiError({ status, code });
    expect(isRetryableDesignError(error(502, 'design_unavailable'))).toBe(true);
    expect(isRetryableDesignError(error(500, 'http_500'))).toBe(true);
    expect(isRetryableDesignError(new TypeError('network'))).toBe(true);
    expect(isRetryableDesignError(error(503, 'hub_unavailable'))).toBe(false);
    expect(isRetryableDesignError(error(401, 'reauth_required'))).toBe(false);
    expect(isRetryableDesignError(error(403, 'design_not_allowed'))).toBe(false);
    expect(isRetryableDesignError(error(404, 'not_found'))).toBe(false);
    expect(retryDesignQuery(0, error(502, 'design_unavailable'))).toBe(true);
    expect(retryDesignQuery(2, error(502, 'design_unavailable'))).toBe(false);
  });
});
