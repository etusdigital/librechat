jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({}));
jest.mock('../hubClient', () => ({ pushSettingsCatalog: jest.fn() }));

const { buildCatalog, usableModels } = require('../catalog');

const fieldOf = (catalog, key) => catalog.fields.find((field) => field.key === key);

describe('buildCatalog', () => {
  const catalog = buildCatalog({
    promptGroups: [
      { _id: { toString: () => '64b000000000000000000002' }, name: 'Resumo de reunião' },
      { _id: { toString: () => '64b000000000000000000001' }, name: 'Análise de contrato' },
    ],
    agents: [{ id: 'agent_1', name: 'Jurídico' }, { id: 'agent_2' }],
    mcpServers: [{ name: 'github', title: 'GitHub' }, { name: 'github' }, { name: 'jira' }],
    modelSpecs: { list: [{ name: 'fast', label: 'Rápido' }] },
    models: {
      openAI: ['gpt-4o', 'gpt-4o-mini'],
      agents: ['ignored'],
      assistants: ['ignored'],
      OpenRouter: ['meta/llama'],
    },
  });

  it('declares every chat field with the hub kinds', () => {
    expect(catalog.fields.map((field) => [field.key, field.kind])).toEqual([
      ['model', 'single'],
      ['temperature', 'number'],
      ['systemPrompt', 'text'],
      ['prompts', 'multi'],
      ['agents', 'multi'],
      ['mcpServers', 'multi'],
    ]);
    expect(fieldOf(catalog, 'temperature')).toMatchObject({ min: 0, max: 2 });
    expect(fieldOf(catalog, 'systemPrompt').maxLength).toBe(8000);
  });

  it('lists model specs first, then endpoint models, skipping non chat endpoints', () => {
    expect(fieldOf(catalog, 'model').options.map((option) => option.id)).toEqual([
      'spec:fast',
      'openAI::gpt-4o',
      'openAI::gpt-4o-mini',
      'OpenRouter::meta/llama',
    ]);
  });

  it('uses resource ids as option ids, sorted by label and deduplicated', () => {
    expect(fieldOf(catalog, 'prompts').options).toEqual([
      { id: '64b000000000000000000001', label: 'Análise de contrato' },
      { id: '64b000000000000000000002', label: 'Resumo de reunião' },
    ]);
    expect(fieldOf(catalog, 'agents').options).toEqual([
      { id: 'agent_2', label: 'agent_2' },
      { id: 'agent_1', label: 'Jurídico' },
    ]);
    expect(fieldOf(catalog, 'mcpServers').options).toEqual([
      { id: 'github', label: 'GitHub' },
      { id: 'jira', label: 'jira' },
    ]);
  });

  it('caps options and long text to the hub limits', () => {
    const many = buildCatalog({
      promptGroups: Array.from({ length: 2500 }, (_, index) => ({
        _id: { toString: () => `id-${index}` },
        name: 'x'.repeat(300),
      })),
    });
    const options = fieldOf(many, 'prompts').options;
    expect(options).toHaveLength(2000);
    expect(options[0].label).toHaveLength(200);
  });
});

describe('usableModels', () => {
  const models = { openAI: ['gpt-4o'], bedrock: ['titan'], 'ETUS AI': ['rapido', 'dev-continuo'] };

  it('keeps only the configured custom endpoints', () => {
    expect(usableModels(models, [{ name: 'ETUS AI' }])).toEqual({
      'ETUS AI': ['rapido', 'dev-continuo'],
    });
  });

  it('keeps everything when no custom endpoint is configured', () => {
    expect(usableModels(models, undefined)).toEqual(models);
  });
});
