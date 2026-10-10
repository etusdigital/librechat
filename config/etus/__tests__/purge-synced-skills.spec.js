const { ResourceType, AccessRoleIds, PrincipalType } = require('librechat-data-provider');
const { startMemoryDb, createUser, insertSyncedSkill, SYNCED_AUTHOR_ID } = require('../test-utils');

jest.mock('../../connect', () => jest.fn().mockResolvedValue(true));

describe('purge-synced-skills', () => {
  let env;
  let models;
  let purgeSyncedSkills;
  let person;

  beforeAll(async () => {
    env = await startMemoryDb();
    models = env.models;
    ({ purgeSyncedSkills } = require('../purge-synced-skills'));
    person = await createUser(models, 'person@etus.test');
  });

  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    await env.clear(['Skill', 'SkillFile', 'AclEntry', 'Agent']);
  });

  async function grantPublicView(skill) {
    const { grantPermission } = require('~/server/services/PermissionService');
    await grantPermission({
      principalType: PrincipalType.PUBLIC,
      principalId: null,
      resourceType: ResourceType.SKILL,
      resourceId: skill._id,
      accessRoleId: AccessRoleIds.SKILL_VIEWER,
      grantedBy: SYNCED_AUTHOR_ID,
    });
  }

  async function seedSkills() {
    const ours = [
      await insertSyncedSkill(models, 'etus-design-systems', { files: ['references/etus.md'] }),
      await insertSyncedSkill(models, 'tpl-saas-landing', {
        files: ['references/a.md', 'assets/b.css'],
      }),
    ];
    const otherSource = await insertSyncedSkill(models, 'etus-design-craft', {
      sourceId: 'another-source',
      files: ['references/c.md'],
    });
    const personal = await models.Skill.create({
      name: 'tpl-saas-landing',
      description: 'A skill a person wrote with the same name as one of ours, long enough.',
      body: 'body',
      author: person._id,
      authorName: 'person',
    });
    for (const skill of [...ours, otherSource]) {
      await grantPublicView(skill);
    }
    return { ours, otherSource, personal };
  }

  it('deletes only the skills, files and permissions of the given source', async () => {
    const { ours, otherSource, personal } = await seedSkills();
    const { createAgent } = require('~/models');
    await createAgent({
      id: 'agent_etus_design',
      name: 'Etus Design',
      provider: 'ETUS AI',
      model: 'cc/claude-sonnet-5',
      author: person._id,
      skills: [ours[0]._id.toString(), otherSource._id.toString()],
      skills_enabled: true,
      skills_scope: 'selected',
    });
    const deleteStoredFile = jest.fn().mockResolvedValue(undefined);

    const result = await purgeSyncedSkills({ sourceId: 'etus-design', deleteStoredFile });

    expect(result.skills.sort()).toEqual(['etus-design-systems', 'tpl-saas-landing']);
    expect(result.fileCount).toBe(3);
    expect(result.incomplete).toEqual([]);
    expect(deleteStoredFile).toHaveBeenCalledTimes(3);
    expect(deleteStoredFile).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'local', filepath: expect.stringContaining('/uploads/') }),
    );

    const remaining = await models.Skill.find({}).lean();
    expect(remaining.map((skill) => skill._id.toString()).sort()).toEqual(
      [otherSource._id.toString(), personal._id.toString()].sort(),
    );
    expect(
      await models.SkillFile.countDocuments({ skillId: { $in: ours.map((s) => s._id) } }),
    ).toBe(0);
    expect(await models.SkillFile.countDocuments({ skillId: otherSource._id })).toBe(1);
    const acl = await models.AclEntry.find({ resourceType: ResourceType.SKILL }).lean();
    expect(acl.map((entry) => entry.resourceId.toString())).toEqual([otherSource._id.toString()]);
    const agent = await models.Agent.findOne({ id: 'agent_etus_design' }).lean();
    expect(agent.skills).toEqual([otherSource._id.toString()]);
  });

  it('does not write anything on --dry-run', async () => {
    await seedSkills();
    const deleteStoredFile = jest.fn();

    const result = await purgeSyncedSkills({
      sourceId: 'etus-design',
      dryRun: true,
      deleteStoredFile,
    });

    expect(result.skills).toHaveLength(2);
    expect(result.fileCount).toBe(3);
    expect(deleteStoredFile).not.toHaveBeenCalled();
    expect(await models.Skill.countDocuments({})).toBe(4);
    expect(await models.SkillFile.countDocuments({})).toBe(4);
    expect(await models.AclEntry.countDocuments({})).toBe(3);
  });

  it('keeps going and reports when a stored file cannot be removed', async () => {
    await seedSkills();
    const deleteStoredFile = jest.fn().mockRejectedValueOnce(new Error('disk busy'));

    const result = await purgeSyncedSkills({ sourceId: 'etus-design', deleteStoredFile });

    expect(result.storageErrors).toHaveLength(1);
    expect(result.storageErrors[0]).toContain('disk busy');
    expect(await models.Skill.countDocuments({ 'sourceMetadata.sourceId': 'etus-design' })).toBe(0);
  });

  it('requires a valid source id and is a no-op for an unknown source', async () => {
    await seedSkills();
    await expect(purgeSyncedSkills({})).rejects.toThrow('--source');
    await expect(purgeSyncedSkills({ sourceId: '{"$ne":null}' })).rejects.toThrow('--source');

    const result = await purgeSyncedSkills({ sourceId: 'nothing-here' });
    expect(result.skills).toEqual([]);
    expect(await models.Skill.countDocuments({})).toBe(4);
  });

  it('runs end to end through the CLI entry point on --dry-run', async () => {
    await seedSkills();
    const { main } = require('../purge-synced-skills');
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await main(['--source', 'etus-design', '--dry-run']);
      expect(log).toHaveBeenCalledWith('[dry-run] source etus-design: 2 skills, 3 files');
      expect(await models.Skill.countDocuments({})).toBe(4);
    } finally {
      log.mockRestore();
    }
  });
});
