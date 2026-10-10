const path = require('path');
const { ResourceType } = require('librechat-data-provider');
const { startMemoryDb, createUser } = require('../test-utils');

jest.mock('../../connect', () => jest.fn().mockResolvedValue(true));

const fixture = require('./fixtures/dist/prompts/prompts.json');
const FIXTURE_FILE = path.join(__dirname, 'fixtures', 'dist', 'prompts', 'prompts.json');

describe('import-prompts', () => {
  let env;
  let models;
  let importPrompts;
  let removePrompts;
  let parsePromptsFile;
  let author;
  let otherUser;

  const file = (items = fixture.items) => ({ ...fixture, items: structuredClone(items) });

  beforeAll(async () => {
    env = await startMemoryDb();
    models = env.models;
    ({ importPrompts, removePrompts, parsePromptsFile } = require('../import-prompts'));
    author = await createUser(models, 'admin@etus.test');
    otherUser = await createUser(models, 'other@etus.test');
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.clear(['PromptGroup', 'Prompt', 'AclEntry']);
  });

  const ownGroups = () => models.PromptGroup.find({ author: author._id }).sort({ name: 1 }).lean();

  it('creates one prompt group per item with the production prompt and owner permission', async () => {
    const result = await importPrompts({ file: file(), author });

    expect(result.counts).toMatchObject({ create: 2, update: 0, unchanged: 0, ownerGranted: 2 });
    const groups = await ownGroups();
    expect(groups.map((group) => [group.name, group.category])).toEqual([
      ['[Imagem] Neon Product Shot', 'etus-design-image'],
      ['[Vídeo] City Timelapse', 'etus-design-video'],
    ]);
    for (const group of groups) {
      const item = fixture.items.find((candidate) => candidate.name === group.name);
      const production = await models.Prompt.findById(group.productionId).lean();
      expect(production).toMatchObject({ prompt: item.prompt, type: 'text' });
      expect(group.oneliner).toBe(item.oneliner);
      const acl = await models.AclEntry.find({
        resourceType: ResourceType.PROMPTGROUP,
        resourceId: group._id,
      }).lean();
      expect(acl).toHaveLength(1);
      expect(acl[0].principalId.toString()).toBe(author._id.toString());
    }
  });

  it('is idempotent: a second run keeps the same groups and prompts', async () => {
    await importPrompts({ file: file(), author });
    const before = await ownGroups();

    const second = await importPrompts({ file: file(), author });

    expect(second.counts).toMatchObject({ create: 0, update: 0, unchanged: 2, ownerGranted: 0 });
    const after = await ownGroups();
    expect(after.map((group) => group._id.toString())).toEqual(
      before.map((group) => group._id.toString()),
    );
    expect(await models.Prompt.countDocuments({})).toBe(2);
    expect(await models.AclEntry.countDocuments({})).toBe(2);
  });

  it('keeps the group id when the prompt changes, so hub shares survive', async () => {
    await importPrompts({ file: file(), author });
    const [image] = await ownGroups();
    const items = structuredClone(fixture.items);
    items[0].prompt = items[0].prompt.replace('85mm lens', '50mm lens');
    items[0].oneliner = 'Updated one-liner.';

    const result = await importPrompts({ file: file(items), author });

    expect(result.counts).toMatchObject({ update: 1, unchanged: 1 });
    const updated = await models.PromptGroup.findById(image._id).lean();
    expect(updated.oneliner).toBe('Updated one-liner.');
    const production = await models.Prompt.findById(updated.productionId).lean();
    expect(production.prompt).toContain('50mm lens');
    expect(await models.Prompt.countDocuments({ groupId: image._id })).toBe(2);
  });

  it('does not write anything on --dry-run', async () => {
    const result = await importPrompts({ file: file(), author, dryRun: true });
    expect(result.counts).toMatchObject({ create: 2, ownerGranted: 2 });
    expect(await models.PromptGroup.countDocuments({})).toBe(0);
    expect(await models.Prompt.countDocuments({})).toBe(0);
    expect(await models.AclEntry.countDocuments({})).toBe(0);
  });

  it('refuses to touch a same-named group of the author outside our categories', async () => {
    const { createPromptGroup } = require('~/models');
    await createPromptGroup({
      prompt: { prompt: 'my own prompt', type: 'text' },
      group: { name: '[Imagem] Neon Product Shot', category: 'marketing' },
      author: author._id,
      authorName: 'admin',
    });

    await expect(importPrompts({ file: file(), author })).rejects.toThrow(
      '[Imagem] Neon Product Shot',
    );
    expect(await models.PromptGroup.countDocuments({})).toBe(1);
    expect(await models.Prompt.countDocuments({})).toBe(1);
  });

  it('reports groups that left the file without deleting them', async () => {
    await importPrompts({ file: file(), author });
    const result = await importPrompts({ file: file(fixture.items.slice(0, 1)), author });
    expect(result.stale).toEqual(['[Vídeo] City Timelapse']);
    expect(await models.PromptGroup.countDocuments({})).toBe(2);
  });

  it('validates the file: category prefix, attribution footer and duplicates', () => {
    const items = structuredClone(fixture.items);
    expect(() => parsePromptsFile(file([{ ...items[0], category: 'marketing' }]))).toThrow(
      'items.0.category',
    );
    expect(() => parsePromptsFile(file([{ ...items[0], prompt: 'No footer at all.' }]))).toThrow(
      'footer',
    );
    expect(() => parsePromptsFile(file([items[0], { ...items[1], name: items[0].name }]))).toThrow(
      'duplicated name',
    );
    expect(() => parsePromptsFile({ ...fixture, version: 2 })).toThrow('version');
    expect(() => parsePromptsFile(file([{ ...items[0], previewImageUrl: 'https://x' }]))).toThrow(
      'previewImageUrl',
    );
  });

  it('--remove deletes only our categories of that author, with their prompts and permissions', async () => {
    const { createPromptGroup } = require('~/models');
    await importPrompts({ file: file(), author });
    await importPrompts({ file: file(), author: otherUser });
    await createPromptGroup({
      prompt: { prompt: 'my own prompt', type: 'text' },
      group: { name: 'Mine', category: 'marketing' },
      author: author._id,
      authorName: 'admin',
    });

    const dry = await removePrompts({ author, dryRun: true });
    expect(dry.removed).toHaveLength(2);
    expect(await models.PromptGroup.countDocuments({})).toBe(5);

    const result = await removePrompts({ author });

    expect(result.removed.sort()).toEqual(['[Imagem] Neon Product Shot', '[Vídeo] City Timelapse']);
    const remaining = await models.PromptGroup.find({}).lean();
    expect(remaining).toHaveLength(3);
    expect(remaining.filter((group) => group.author.equals(author._id)).map((g) => g.name)).toEqual(
      ['Mine'],
    );
    const remainingIds = remaining.map((group) => group._id.toString());
    const prompts = await models.Prompt.find({}).lean();
    expect(prompts.every((prompt) => remainingIds.includes(prompt.groupId.toString()))).toBe(true);
    const acl = await models.AclEntry.find({ resourceType: ResourceType.PROMPTGROUP }).lean();
    expect(acl.every((entry) => remainingIds.includes(entry.resourceId.toString()))).toBe(true);
  });

  it('runs end to end through the CLI entry point', async () => {
    const { main } = require('../import-prompts');
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await main(['--file', FIXTURE_FILE, '--author-email', 'admin@etus.test', '--dry-run']);
      expect(await models.PromptGroup.countDocuments({})).toBe(0);
      await main(['--file', FIXTURE_FILE, '--author-email', 'admin@etus.test']);
      await main(['--file', FIXTURE_FILE, '--author-email', 'admin@etus.test']);
      expect(await models.PromptGroup.countDocuments({})).toBe(2);
      await main(['--remove', '--author-email', 'admin@etus.test']);
      expect(await models.PromptGroup.countDocuments({})).toBe(0);
      expect(log.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          '[dry-run] created 2, updated 0, unchanged 0, owner permissions granted 2',
          'created 0, updated 0, unchanged 2, owner permissions granted 0',
          'removed 2 prompt groups',
        ]),
      );
    } finally {
      log.mockRestore();
    }
  });
});
