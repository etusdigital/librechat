const axios = require('axios');
const OpenAI = require('openai');
const createOpenAIImageTools = require('../OpenAIImageTools');

jest.mock('axios');
jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({
    getDownloadStream: jest.fn().mockResolvedValue(Buffer.from('image')),
  })),
}));
jest.mock('~/models', () => ({ getFiles: jest.fn().mockResolvedValue([]) }));

const toJwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = () => Math.floor(Date.now() / 1000);

function personIdToken() {
  return [
    toJwtPart({ alg: 'none' }),
    toJwtPart({ sub: 'person-1', email: 'person@example.com', exp: nowSeconds() + 3600 }),
    'signature',
  ].join('.');
}

function signedInRequest(idToken) {
  return {
    user: {
      id: 'user-1',
      provider: 'openid',
      openidId: 'person-1',
      federatedTokens: {
        access_token: 'access-token',
        id_token: idToken,
        expires_at: nowSeconds() + 3600,
      },
    },
  };
}

const toolCall = (name, args) => ({ id: 'call_1', name, args, type: 'tool_call' });

describe('OpenAI image tools extra headers', () => {
  const ENV_KEYS = ['IMAGE_GEN_OAI_API_KEY', 'IMAGE_GEN_OAI_BASEURL', 'IMAGE_GEN_OAI_HEADERS'];
  const savedEnv = {};
  let generate;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.IMAGE_GEN_OAI_API_KEY = 'gateway-key';
    process.env.IMAGE_GEN_OAI_BASEURL = 'https://gateway.example.com/v1';
    generate = jest.fn().mockResolvedValue({ data: [{ b64_json: 'aGVsbG8=' }] });
    OpenAI.mockImplementation(() => ({ images: { generate } }));
    axios.post.mockResolvedValue({ data: { data: [{ b64_json: 'aGVsbG8=' }] } });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('sends the signed-in person id token when the headers ask for it', async () => {
    process.env.IMAGE_GEN_OAI_HEADERS = JSON.stringify({
      'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
    });
    const idToken = personIdToken();
    const [imageGen] = createOpenAIImageTools({ isAgent: true, req: signedInRequest(idToken) });

    await imageGen.invoke(toolCall('image_gen_oai', { prompt: 'a leaf' }));

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'gateway-key',
        defaultHeaders: expect.objectContaining({ 'X-Etus-Id-Token': idToken }),
      }),
    );
    expect(generate).toHaveBeenCalled();
  });

  it('adds the headers to image edits too', async () => {
    process.env.IMAGE_GEN_OAI_HEADERS = JSON.stringify({
      'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
    });
    const idToken = personIdToken();
    const [, imageEdit] = createOpenAIImageTools({
      isAgent: true,
      req: signedInRequest(idToken),
      imageFiles: [{ file_id: 'file-1', filename: 'a.png', type: 'image/png', source: 'local' }],
    });

    await imageEdit.invoke(
      toolCall('image_edit_oai', { prompt: 'greener', image_ids: ['file-1'] }),
    );

    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers['X-Etus-Id-Token']).toBe(idToken);
    expect(config.headers.Authorization).toBe('Bearer gateway-key');
  });

  it('omits the header for someone without an OpenID session', async () => {
    process.env.IMAGE_GEN_OAI_HEADERS = JSON.stringify({
      'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
    });
    const [imageGen] = createOpenAIImageTools({ isAgent: true, req: { user: { id: 'user-1' } } });

    await imageGen.invoke(toolCall('image_gen_oai', { prompt: 'a leaf' }));

    const [config] = OpenAI.mock.calls[0];
    expect(config.defaultHeaders).not.toHaveProperty('X-Etus-Id-Token');
  });

  it('ignores headers that are not a JSON object of strings', async () => {
    process.env.IMAGE_GEN_OAI_HEADERS = '["X-Etus-Id-Token"]';
    const [imageGen] = createOpenAIImageTools({
      isAgent: true,
      req: signedInRequest(personIdToken()),
    });

    await imageGen.invoke(toolCall('image_gen_oai', { prompt: 'a leaf' }));

    const [config] = OpenAI.mock.calls[0];
    expect(config.defaultHeaders).toBeUndefined();
  });

  it('keeps the previous behaviour when no headers are configured', async () => {
    delete process.env.IMAGE_GEN_OAI_HEADERS;
    const [imageGen] = createOpenAIImageTools({
      isAgent: true,
      req: signedInRequest(personIdToken()),
    });

    await imageGen.invoke(toolCall('image_gen_oai', { prompt: 'a leaf' }));

    const [config] = OpenAI.mock.calls[0];
    expect(config).toEqual({ apiKey: 'gateway-key', baseURL: 'https://gateway.example.com/v1' });
  });
});
