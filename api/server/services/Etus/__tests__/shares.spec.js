jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({
  upsertGroupByExternalId: jest.fn(),
  deleteAclEntries: jest.fn(),
  invalidatePromptGroupAccessContext: jest.fn(),
}));
jest.mock('~/server/services/PermissionService', () => ({ grantPermission: jest.fn() }));
jest.mock('../hubClient', () => ({
  fetchAccessVersion: jest.fn(),
  fetchOrganizationSettings: jest.fn(),
}));

const mongoose = require('mongoose');
const db = require('~/models');
const { grantPermission } = require('~/server/services/PermissionService');
const { fetchAccessVersion, fetchOrganizationSettings } = require('../hubClient');
const { SYNC_MARKER, planShareChanges, syncHubShares, resetShareState } = require('../shares');

const share = (principalId, resourceId, extra = {}) => ({
  principalId,
  resourceType: 'promptGroup',
  resourceId,
  ...extra,
});

describe('planShareChanges', () => {
  it('grants what is missing and revokes only what the sync created', () => {
    const { grants, revokes } = planShareChanges({
      desired: [share('g1', 'r1'), share('g1', 'r2'), share('g1', 'r2')],
      owned: [share('g1', 'r1', { _id: 'a' }), share('g2', 'r9', { _id: 'b' })],
      manual: [],
      allowRevoke: true,
    });
    expect(grants).toEqual([share('g1', 'r2')]);
    expect(revokes.map((entry) => entry._id)).toEqual(['b']);
  });

  it('never grants over a manual share', () => {
    const { grants } = planShareChanges({
      desired: [share('g1', 'r1')],
      owned: [],
      manual: [share('g1', 'r1', { _id: 'm' })],
      allowRevoke: true,
    });
    expect(grants).toEqual([]);
  });

  it('only adds when some company could not be read', () => {
    const { grants, revokes } = planShareChanges({
      desired: [share('g1', 'r2')],
      owned: [share('g1', 'r1', { _id: 'a' })],
      manual: [],
      allowRevoke: false,
    });
    expect(grants).toEqual([share('g1', 'r2')]);
    expect(revokes).toEqual([]);
  });

  it('treats resource types separately', () => {
    const { grants } = planShareChanges({
      desired: [share('g1', 'r1', { resourceType: 'agent' })],
      owned: [share('g1', 'r1', { _id: 'a' })],
      manual: [],
      allowRevoke: true,
    });
    expect(grants).toHaveLength(1);
  });
});

describe('syncHubShares', () => {
  const ids = {
    group: new mongoose.Types.ObjectId(),
    prompt: new mongoose.Types.ObjectId(),
    oldPrompt: new mongoose.Types.ObjectId(),
    agent: new mongoose.Types.ObjectId(),
    skill: new mongoose.Types.ObjectId(),
    oldSkill: new mongoose.Types.ObjectId(),
  };
  const lean = (value) => ({ lean: async () => value });
  const saved = {};
  let aclEntries;

  beforeAll(() => {
    for (const name of ['Group', 'AclEntry', 'PromptGroup', 'Agent', 'MCPServer', 'Skill']) {
      saved[name] = mongoose.models[name];
    }
  });

  afterAll(() => {
    for (const [name, model] of Object.entries(saved)) {
      if (model) {
        mongoose.models[name] = model;
      } else {
        delete mongoose.models[name];
      }
    }
  });

  beforeEach(() => {
    resetShareState();
    aclEntries = [
      {
        _id: 'owned-old',
        principalId: ids.group,
        resourceType: 'promptGroup',
        resourceId: ids.oldPrompt,
        grantedBy: SYNC_MARKER,
      },
    ];
    mongoose.models.Group = { find: jest.fn(() => lean([{ idOnTheSource: 'hub:org:org1' }])) };
    mongoose.models.AclEntry = {
      find: jest.fn((filter) => lean(filter.grantedBy?.$ne ? [] : aclEntries)),
    };
    mongoose.models.PromptGroup = { find: jest.fn(() => lean([{ _id: ids.prompt }])) };
    mongoose.models.Agent = { find: jest.fn(() => lean([{ _id: ids.agent, id: 'agent_1' }])) };
    mongoose.models.MCPServer = { find: jest.fn(() => lean([])) };
    mongoose.models.Skill = { find: jest.fn(() => lean([{ _id: ids.skill }])) };
    db.upsertGroupByExternalId.mockResolvedValue({ _id: ids.group });
    fetchAccessVersion.mockResolvedValue({ version: 5 });
    fetchOrganizationSettings.mockResolvedValue({
      version: 5,
      organization: { id: 'org1', name: 'Etus' },
      entries: [
        {
          groupId: 'hub:profile:p1',
          subject: { kind: 'profile', id: 'p1', name: 'Comercial' },
          values: { prompts: [ids.prompt.toString()], agents: ['agent_1'], model: 'a::b' },
        },
      ],
    });
  });

  it('grants viewer shares to hub groups and revokes the stale ones it created', async () => {
    const result = await syncHubShares();

    expect(result).toEqual({ grants: 2, revokes: 1 });
    expect(db.upsertGroupByExternalId).toHaveBeenCalledWith('hub:profile:p1', 'entra', {
      name: 'Comercial',
      description: 'Tipo de acesso em Etus',
    });
    expect(grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: 'group',
        principalId: ids.group.toString(),
        resourceType: 'promptGroup',
        resourceId: ids.prompt.toString(),
        accessRoleId: 'promptGroup_viewer',
        grantedBy: SYNC_MARKER,
      }),
    );
    expect(grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'agent', accessRoleId: 'agent_viewer' }),
    );
    expect(db.deleteAclEntries).toHaveBeenCalledWith({ _id: { $in: ['owned-old'] } });
    expect(db.invalidatePromptGroupAccessContext).toHaveBeenCalled();
  });

  it('shares hub skills with the group as skill viewer', async () => {
    fetchOrganizationSettings.mockResolvedValue({
      version: 5,
      organization: { id: 'org1', name: 'Etus' },
      entries: [
        {
          groupId: 'hub:team:t1',
          subject: { kind: 'team', id: 't1', name: 'Design' },
          values: { skills: [ids.skill.toString(), 'not-an-id'] },
        },
      ],
    });

    const result = await syncHubShares();

    expect(result.grants).toBe(1);
    expect(mongoose.models.Skill.find).toHaveBeenCalledWith(
      { _id: { $in: [ids.skill.toString()] } },
      expect.anything(),
    );
    expect(grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: 'group',
        principalId: ids.group.toString(),
        resourceType: 'skill',
        resourceId: ids.skill.toString(),
        accessRoleId: 'skill_viewer',
        grantedBy: SYNC_MARKER,
      }),
    );
  });

  it('revokes a skill share the sync created once the hub drops it', async () => {
    aclEntries = [
      {
        _id: 'owned-skill',
        principalId: ids.group,
        resourceType: 'skill',
        resourceId: ids.oldSkill,
        grantedBy: SYNC_MARKER,
      },
    ];
    mongoose.models.Skill.find.mockReturnValue(lean([]));
    fetchOrganizationSettings.mockResolvedValue({
      version: 6,
      organization: { id: 'org1', name: 'Etus' },
      entries: [
        {
          groupId: 'hub:team:t1',
          subject: { kind: 'team', id: 't1', name: 'Design' },
          values: { skills: [] },
        },
      ],
    });

    const result = await syncHubShares();

    expect(result).toEqual({ grants: 0, revokes: 1 });
    expect(db.deleteAclEntries).toHaveBeenCalledWith({ _id: { $in: ['owned-skill'] } });
    expect(db.invalidatePromptGroupAccessContext).not.toHaveBeenCalled();
  });

  it('skips the pass when no company version moved', async () => {
    await syncHubShares();
    grantPermission.mockClear();
    fetchOrganizationSettings.mockClear();
    expect(await syncHubShares()).toEqual({ grants: 0, revokes: 0 });
    expect(fetchOrganizationSettings).not.toHaveBeenCalled();
    expect(grantPermission).not.toHaveBeenCalled();
  });

  it('does not revoke anything when the hub is down', async () => {
    fetchAccessVersion.mockResolvedValue(null);
    const result = await syncHubShares();
    expect(result.revokes).toBe(0);
    expect(db.deleteAclEntries).not.toHaveBeenCalled();
  });
});
