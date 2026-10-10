jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({}));
jest.mock('../hubClient', () => ({ pushSettingsCatalog: jest.fn() }));

const { buildCatalog, usableModels, catalogMcpServers } = require('../catalog');

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
      ['skills', 'multi'],
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

describe('skills field', () => {
  const skillAt = (index, extra = {}) => ({
    _id: { toString: () => `64c${String(index).padStart(21, '0')}` },
    name: `skill-${String(index).padStart(3, '0')}`,
    ...extra,
  });

  it('lists every skill when there are more than 100', () => {
    const skills = Array.from({ length: 150 }, (_, index) => skillAt(index));
    const options = fieldOf(buildCatalog({ skills }), 'skills').options;
    expect(options).toHaveLength(150);
    expect(new Set(options.map((option) => option.id)).size).toBe(150);
    expect(options[0]).toEqual({ id: '64c000000000000000000000', label: 'skill-000' });
  });

  it('prefers the display title and clips the description to 280 characters', () => {
    const options = fieldOf(
      buildCatalog({
        skills: [
          skillAt(1, { displayTitle: 'Landing SaaS', description: `  ${'d'.repeat(400)}  ` }),
          skillAt(2, { description: '   ' }),
        ],
      }),
      'skills',
    ).options;
    expect(options).toEqual([
      { id: '64c000000000000000000001', label: 'Landing SaaS', description: 'd'.repeat(280) },
      { id: '64c000000000000000000002', label: 'skill-002' },
    ]);
  });

  it('caps the skill options at the hub limit', () => {
    const skills = Array.from({ length: 2100 }, (_, index) => skillAt(index));
    expect(fieldOf(buildCatalog({ skills }), 'skills').options).toHaveLength(2000);
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

describe('catalogMcpServers', () => {
  it('offers YAML, hub-controlled and database servers to the hub', () => {
    const servers = catalogMcpServers(
      {
        mcpConfig: { github: { title: 'GitHub' } },
        etusControlledMcpServers: { etus: { title: 'Apps da Etus' } },
      },
      [{ serverName: 'notion', config: { title: 'Notion' } }],
    );
    expect(servers).toEqual([
      { name: 'github', title: 'GitHub' },
      { name: 'etus', title: 'Apps da Etus' },
      { name: 'notion', title: 'Notion' },
    ]);
  });
});
