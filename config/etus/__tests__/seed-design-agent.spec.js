const path = require('path');
const { ResourceType, PrincipalType, PermissionBits } = require('librechat-data-provider');
const { startMemoryDb, createUser, insertSyncedSkill } = require('../test-utils');

jest.mock('../../connect', () => jest.fn().mockResolvedValue(true));

const fixture = require('./fixtures/etus-design.agent.json');
const AGENT_ID = fixture.id;
const SKILL_NAMES = fixture.skillNames;

describe('seed-design-agent', () => {
  let env;
  let models;
  let seedDesignAgent;
  let removeDesignAgent;
  let parseAgentDefinition;
  let author;
  let otherUser;
  let skillIds;

  const definition = (overrides = {}) => ({ ...fixture, ...overrides });

  beforeAll(async () => {
    env = await startMemoryDb();
    models = env.models;
    ({
      seedDesignAgent,
      removeDesignAgent,
      parseAgentDefinition,
    } = require('../seed-design-agent'));
    author = await createUser(models, 'admin@etus.test');
    otherUser = await createUser(models, 'other@etus.test');
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.clear(['Agent', 'AclEntry', 'Skill', 'SkillFile']);
    const skills = [];
    for (const name of SKILL_NAMES) {
      skills.push(await insertSyncedSkill(models, name));
    }
    skillIds = skills.map((skill) => skill._id.toString());
  });

  const ownerEntries = (agentObjectId) =>
    models.AclEntry.find({ resourceType: ResourceType.AGENT, resourceId: agentObjectId }).lean();

  it('creates the agent with the corrected provider, skills and owner permission', async () => {
    const result = await seedDesignAgent({ definition: definition(), author });

    expect(result.action).toBe('create');
    expect(result.ownerGranted).toBe(true);
    const agent = await models.Agent.findOne({ id: AGENT_ID }).lean();
    expect(agent).toMatchObject({
      name: 'Etus Design',
      provider: 'ETUS AI',
      model: 'cc/claude-sonnet-5',
      artifacts: 'default',
      tools: ['image_gen_oai', 'ask_user_question'],
      skills: skillIds,
      skills_enabled: true,
      skills_scope: 'selected',
      category: 'general',
    });
    expect(agent.author.toString()).toBe(author._id.toString());
    expect(agent.versions).toHaveLength(1);

    const entries = await ownerEntries(agent._id);
    expect(entries).toHaveLength(1);
    expect(entries[0].principalType).toBe(PrincipalType.USER);
    expect(entries[0].principalId.toString()).toBe(author._id.toString());
    expect(entries[0].permBits & PermissionBits.SHARE).toBe(PermissionBits.SHARE);
  });

  it('is idempotent: a second run writes nothing', async () => {
    await seedDesignAgent({ definition: definition(), author });
    const before = await models.Agent.findOne({ id: AGENT_ID }).lean();

    const second = await seedDesignAgent({ definition: definition(), author });

    expect(second.action).toBe('unchanged');
    expect(second.changes).toEqual([]);
    expect(second.ownerGranted).toBe(false);
    const after = await models.Agent.findOne({ id: AGENT_ID }).lean();
    expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(1);
    expect(after.versions).toHaveLength(1);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await ownerEntries(after._id)).toHaveLength(1);
  });

  it('updates with a new version and reports the diff', async () => {
    await seedDesignAgent({ definition: definition(), author });

    const result = await seedDesignAgent({
      definition: definition({
        instructions: 'New instructions.',
        skillNames: SKILL_NAMES.slice(0, 2),
      }),
      author,
    });

    expect(result.action).toBe('update');
    expect(result.changes.map((change) => change.field)).toEqual(['instructions', 'skills']);
    const agent = await models.Agent.findOne({ id: AGENT_ID }).lean();
    expect(agent.instructions).toBe('New instructions.');
    expect(agent.skills).toEqual(skillIds.slice(0, 2));
    expect(agent.versions).toHaveLength(2);
    expect(await ownerEntries(agent._id)).toHaveLength(1);
  });

  it('does not write anything on --dry-run', async () => {
    const created = await seedDesignAgent({ definition: definition(), author, dryRun: true });
    expect(created).toMatchObject({ action: 'create', dryRun: true, ownerGranted: true });
    expect(await models.Agent.countDocuments({})).toBe(0);
    expect(await models.AclEntry.countDocuments({})).toBe(0);

    await seedDesignAgent({ definition: definition(), author });
    const updated = await seedDesignAgent({
      definition: definition({ name: 'Etus Design 2' }),
      author,
      dryRun: true,
    });
    expect(updated.action).toBe('update');
    expect(updated.changes).toEqual([
      { field: 'name', before: 'Etus Design', after: 'Etus Design 2' },
    ]);
    const agent = await models.Agent.findOne({ id: AGENT_ID }).lean();
    expect(agent.name).toBe('Etus Design');
    expect(agent.versions).toHaveLength(1);
  });

  it('fails without writing when a skill was not synced', async () => {
    await expect(
      seedDesignAgent({
        definition: definition({ skillNames: [...SKILL_NAMES, 'tpl-missing'] }),
        author,
      }),
    ).rejects.toThrow('Skills not synced from source "etus-design": tpl-missing');
    expect(await models.Agent.countDocuments({})).toBe(0);
  });

  it('seeds the synced skills only when --allow-missing is passed', async () => {
    const result = await seedDesignAgent({
      definition: definition({ skillNames: [...SKILL_NAMES, 'tpl-missing'] }),
      author,
      allowMissing: true,
    });
    expect(result.missingSkills).toEqual(['tpl-missing']);
    expect(result.warnings.join(' ')).toContain('tpl-missing');
    const agent = await models.Agent.findOne({ id: AGENT_ID }).lean();
    expect(agent.skills).toEqual(skillIds);
  });

  it('resolves skills by the skillSync source id, ignoring same-named skills elsewhere', async () => {
    await models.Skill.deleteMany({ name: 'tpl-saas-landing' });
    await insertSyncedSkill(models, 'tpl-saas-landing', { sourceId: 'other-source' });
    await models.Skill.create({
      name: 'tpl-saas-landing',
      description: 'A skill a person wrote with the same name as ours, long enough.',
      body: 'body',
      author: otherUser._id,
      authorName: 'other',
    });

    await expect(seedDesignAgent({ definition: definition(), author })).rejects.toThrow(
      'tpl-saas-landing',
    );
  });

  it('rejects a provider other than the ETUS AI custom endpoint', () => {
    expect(() => parseAgentDefinition(definition({ provider: 'OmniRoute' }))).toThrow(
      'must be "ETUS AI"',
    );
  });

  it('rejects tools outside the allowlist and unknown fields', () => {
    expect(() => parseAgentDefinition(definition({ tools: ['execute_code'] }))).toThrow('tools.0');
    expect(() => parseAgentDefinition(definition({ skills: ['x'] }))).toThrow('skills');
  });

  it('rejects skill settings that would leave the agent without its skills', () => {
    expect(() => parseAgentDefinition(definition({ skills_enabled: false }))).toThrow(
      'skills_enabled',
    );
    expect(() => parseAgentDefinition(definition({ skills_scope: 'all' }))).toThrow('skills_scope');
  });

  it('fills skills_enabled and skills_scope when the JSON omits them', () => {
    const { skills_enabled, skills_scope, ...rest } = fixture;
    expect(skills_enabled && skills_scope).toBeTruthy();
    expect(parseAgentDefinition(rest)).toMatchObject({
      skills_enabled: true,
      skills_scope: 'selected',
      skill_authoring_enabled: false,
    });
  });

  it('never lets the curated agent author skills', () => {
    expect(() => parseAgentDefinition(definition({ skill_authoring_enabled: true }))).toThrow(
      'skill_authoring_enabled',
    );
  });

  it('warns when the model differs from the recommended one', async () => {
    const result = await seedDesignAgent({
      definition: definition({ model: 'cc/claude-opus-5-5' }),
      author,
      dryRun: true,
    });
    expect(result.warnings.join(' ')).toContain('cc/claude-opus-5-5');
  });

  it('refuses to change an agent with the same id owned by someone else', async () => {
    await seedDesignAgent({ definition: definition(), author: otherUser });
    await expect(seedDesignAgent({ definition: definition(), author })).rejects.toThrow(
      'belongs to another author',
    );
    await expect(removeDesignAgent({ agentId: AGENT_ID, author })).rejects.toThrow(
      'belongs to another author',
    );
    expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(1);
  });

  it('--remove deletes only our agent and its permissions', async () => {
    const { createAgent } = require('~/models');
    const other = await createAgent({
      id: 'agent_someone_else',
      name: 'Other',
      provider: 'ETUS AI',
      model: 'cc/claude-sonnet-5',
      author: otherUser._id,
    });
    await seedDesignAgent({ definition: definition(), author });
    const ours = await models.Agent.findOne({ id: AGENT_ID }).lean();

    const dry = await removeDesignAgent({ agentId: AGENT_ID, author, dryRun: true });
    expect(dry.action).toBe('remove');
    expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(1);

    const removed = await removeDesignAgent({ agentId: AGENT_ID, author });
    expect(removed.action).toBe('remove');
    expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(0);
    expect(await ownerEntries(ours._id)).toHaveLength(0);
    expect(await models.Agent.countDocuments({ id: other.id })).toBe(1);
    expect(await models.Skill.countDocuments({})).toBe(SKILL_NAMES.length);

    const again = await removeDesignAgent({ agentId: AGENT_ID, author });
    expect(again.action).toBe('absent');
  });

  it('runs end to end through the CLI entry point', async () => {
    const { main } = require('../seed-design-agent');
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const file = path.join(__dirname, 'fixtures', 'etus-design.agent.json');
    try {
      await main(['--file', file, '--author-email', 'ADMIN@etus.test', '--dry-run']);
      expect(await models.Agent.countDocuments({})).toBe(0);
      await main(['--file', file, '--author-email', 'admin@etus.test']);
      await main(['--file', file, '--author-email', 'admin@etus.test']);
      expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(1);
      expect(log.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([
          `[dry-run] create: ${AGENT_ID}`,
          `create: ${AGENT_ID}`,
          `unchanged: ${AGENT_ID}`,
        ]),
      );
      await main(['--remove', '--file', file, '--author-email', 'admin@etus.test']);
      expect(await models.Agent.countDocuments({ id: AGENT_ID })).toBe(0);
    } finally {
      log.mockRestore();
    }
  });
});
