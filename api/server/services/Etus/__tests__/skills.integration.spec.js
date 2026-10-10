const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');
const {
  AccessRoleIds,
  PermissionBits,
  PrincipalType,
  ResourceType,
  SystemRoles,
} = require('librechat-data-provider');

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  getTransactionSupport: jest.fn().mockResolvedValue(false),
}));
jest.mock('~/server/services/GraphApiService', () => ({
  entraIdPrincipalFeatureEnabled: jest.fn().mockReturnValue(false),
  getUserOwnedEntraGroups: jest.fn().mockResolvedValue([]),
  getUserEntraGroups: jest.fn().mockResolvedValue([]),
  getEntraGroupDetailsBatch: jest.fn().mockResolvedValue([]),
  getGroupMembers: jest.fn().mockResolvedValue([]),
  getGroupOwners: jest.fn().mockResolvedValue([]),
}));
jest.mock('../hubClient', () => ({
  fetchAccessVersion: jest.fn(),
  fetchOrganizationSettings: jest.fn(),
  pushSettingsCatalog: jest.fn(),
}));

const { fetchAccessVersion, fetchOrganizationSettings } = require('../hubClient');

let mongoServer;
let models;
let db;
let grantPermission;
let findAccessibleResources;
let syncHubGroups;
let syncHubShares;
let resetShareState;
let collectCatalog;
let syncHubSkills;
let resetSettingsCache;

const objectId = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  models = require('~/db/models');
  Object.assign(mongoose.models, models);
  db = require('~/models');
  await db.seedDefaultRoles();
  ({ grantPermission, findAccessibleResources } = require('~/server/services/PermissionService'));
  ({ syncHubGroups } = require('../groups'));
  ({ syncHubShares, resetShareState } = require('../shares'));
  ({ collectCatalog } = require('../catalog'));
  ({ syncHubSkills } = require('../skillActivation'));
  ({ resetSettingsCache } = require('../settingsCache'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

async function createUser(fields = {}) {
  return models.User.create({
    name: 'Pessoa',
    email: `${objectId().toString()}@etus.io`,
    provider: 'openid',
    role: SystemRoles.USER,
    ...fields,
  });
}

async function createSkill(author, fields = {}) {
  return models.Skill.create({
    name: `skill-${objectId().toString().slice(-8)}`,
    description: 'Skill de teste',
    body: '# Corpo',
    author,
    authorName: 'Autor',
    ...fields,
  });
}

function hubAnswers(version, values) {
  fetchAccessVersion.mockResolvedValue({ version });
  fetchOrganizationSettings.mockResolvedValue({
    version,
    organization: { id: 'org1', name: 'Etus' },
    entries: [
      { groupId: 'hub:team:t1', subject: { kind: 'team', id: 't1', name: 'Design' }, values },
    ],
  });
}

const canView = async (user) =>
  (
    await findAccessibleResources({
      userId: user._id,
      role: user.role,
      resourceType: ResourceType.SKILL,
      requiredPermissions: PermissionBits.VIEW,
    })
  ).map(String);

describe('skills shared by the hub', () => {
  let admin;
  let member;
  let outsider;
  let syncedSkill;
  let personalSkill;

  beforeAll(async () => {
    admin = await createUser({ role: SystemRoles.ADMIN });
    member = await createUser();
    outsider = await createUser();
    const owner = await createUser();
    syncedSkill = await createSkill(objectId(), {
      source: 'github',
      sourceMetadata: { sourceId: 'etus-design' },
    });
    personalSkill = await createSkill(owner._id);
    await grantPermission({
      principalType: PrincipalType.PUBLIC,
      principalId: null,
      resourceType: ResourceType.SKILL,
      resourceId: syncedSkill._id,
      accessRoleId: AccessRoleIds.SKILL_VIEWER,
      grantedBy: syncedSkill.author,
    });
    await syncHubGroups(member, [
      { id: 'hub:org:org1', kind: 'company', name: 'Etus' },
      { id: 'hub:team:t1', kind: 'team', name: 'Design', organizationName: 'Etus' },
    ]);
    await syncHubGroups(outsider, [{ id: 'hub:org:org1', kind: 'company', name: 'Etus' }]);
    resetShareState();
  });

  it('gives the group access to a personal skill and takes it back on revocation', async () => {
    expect(await canView(member)).not.toContain(personalSkill._id.toString());

    hubAnswers(1, { skills: [personalSkill._id.toString(), syncedSkill._id.toString()] });
    expect(await syncHubShares()).toEqual({ grants: 2, revokes: 0 });
    expect(await canView(member)).toContain(personalSkill._id.toString());
    expect(await canView(outsider)).not.toContain(personalSkill._id.toString());

    hubAnswers(2, { skills: [] });
    expect(await syncHubShares()).toEqual({ grants: 0, revokes: 2 });
    expect(await canView(member)).not.toContain(personalSkill._id.toString());
  });

  it('cannot restrict a skill synced from GitHub, which is already public', async () => {
    expect(await canView(outsider)).toContain(syncedSkill._id.toString());

    hubAnswers(3, { skills: [syncedSkill._id.toString()] });
    await syncHubShares();
    expect(await canView(outsider)).toContain(syncedSkill._id.toString());

    hubAnswers(4, { skills: [] });
    await syncHubShares();
    expect(await canView(member)).toContain(syncedSkill._id.toString());
    expect(await canView(outsider)).toContain(syncedSkill._id.toString());
  });

  it('offers admin and public skills in the catalog, but not personal ones', async () => {
    const adminSkill = await createSkill(admin._id, { displayTitle: 'Skill do admin' });
    const catalog = await collectCatalog({ appConfig: {}, loadModels: jest.fn(async () => ({})) });
    const ids = catalog.fields.find((field) => field.key === 'skills').options.map((o) => o.id);

    expect(ids).toEqual(
      expect.arrayContaining([adminSkill._id.toString(), syncedSkill._id.toString()]),
    );
    expect(ids).not.toContain(personalSkill._id.toString());
  });
});

describe('skill activation by the hub', () => {
  let person;
  let agentSkills;
  let hubSkill;
  let refusedSkill;

  const statesOf = async () => (await models.User.findById(person._id).lean()).skillStates;

  beforeAll(async () => {
    resetSettingsCache();
    const author = objectId();
    agentSkills = [await createSkill(author), await createSkill(author)];
    refusedSkill = await createSkill(author);
    hubSkill = await createSkill(author);
    await models.Agent.create({
      id: 'agent_etus_design',
      name: 'Etus Design',
      provider: 'ETUS AI',
      model: 'cc/claude-sonnet-5',
      author,
      skills: [...agentSkills, refusedSkill].map((skill) => skill._id.toString()),
      skills_enabled: true,
      skills_scope: 'selected',
    });
    person = await createUser({ skillStates: { [refusedSkill._id.toString()]: false } });
  });

  it('turns on the agent skills and the hub skills, keeping the explicit false', async () => {
    await syncHubSkills(person._id.toString(), {
      agents: ['agent_etus_design'],
      skills: [hubSkill._id.toString()],
    });

    expect(await statesOf()).toEqual({
      [hubSkill._id.toString()]: true,
      [agentSkills[0]._id.toString()]: true,
      [agentSkills[1]._id.toString()]: true,
      [refusedSkill._id.toString()]: false,
    });
  });

  it('keeps the states the person changed and clears the rest when access ends', async () => {
    await models.User.updateOne(
      { _id: person._id },
      { $set: { [`skillStates.${agentSkills[0]._id}`]: false } },
    );

    await syncHubSkills(person._id.toString(), {});

    expect(await statesOf()).toEqual({
      [agentSkills[0]._id.toString()]: false,
      [refusedSkill._id.toString()]: false,
    });
  });
});
