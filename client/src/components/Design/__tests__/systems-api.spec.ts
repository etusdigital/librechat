import { request } from 'librechat-data-provider';
import { designApi } from '../api/client';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: () => '',
    request: { ...actual.request, authenticatedFetch: jest.fn() },
  };
});

const fetchMock = request.authenticatedFetch as jest.Mock;

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

function sentHeaders() {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return Object.keys(init.headers as Record<string, string>).map((name) => name.toLowerCase());
}

describe('gallery calls go through the chat proxy only (C-17, client side)', () => {
  it('lists and reads design systems under /api/etus/design', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [], nextCursor: null, total: 0, categories: [] }),
    );
    await designApi.listDesignSystems({ query: 'saas', category: '', limit: 48, cursor: '48' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/etus/design/design-systems?query=saas&limit=48&cursor=48',
      expect.objectContaining({ method: 'GET' }),
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'air/bnb' }));
    await designApi.getDesignSystem('air/bnb');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/etus/design/design-systems/air%2Fbnb',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves the company default with a PUT and no token or hub header from the browser', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { designSystemId: 'airbnb', organizationId: 'org_1' }),
    );
    await designApi.setCompanyDefaultDesignSystem('airbnb');
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe('/api/etus/design/company/default-design-system');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ designSystemId: 'airbnb' });
    expect(sentHeaders()).toEqual(['accept', 'content-type']);
  });

  it('updates only the design system of a project', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projectId: 'prj_1' }));
    await designApi.updateProject('prj_1', { designSystemId: 'airbnb' });
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(url).toBe('/api/etus/design/projects/prj_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ designSystemId: 'airbnb' });
    expect(
      sentHeaders().some((name) => name.startsWith('x-etus') || name === 'authorization'),
    ).toBe(false);
  });
});
