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

let mongoServer;
let models;
let grantPermission;
let findAccessibleResources;
let AGENT_ACCESS_MARKER;
let applyAgentAccess;
let parseAgentAccess;
let SYNC_MARKER;

const objectId = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  models = require('~/db/models');
  Object.assign(mongoose.models, models);
  await require('~/models').seedDefaultRoles();
  ({ grantPermission, findAccessibleResources } = require('~/server/services/PermissionService'));
  ({ AGENT_ACCESS_MARKER, applyAgentAccess, parseAgentAccess } = require('../agentAccess'));
  ({ SYNC_MARKER } = require('../../shares'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

const createUser = (fields = {}) =>
  models.User.create({
    name: 'Pessoa',
    email: `${objectId().toString()}@etus.io`,
    provider: 'openid',
    role: SystemRoles.USER,
    ...fields,
  });

const createAgent = (id, author) =>
  models.Agent.create({ id, name: id, provider: 'ETUS AI', model: 'cc/claude-sonnet-5', author });

const visibleAgents = async (user) =>
  (
    await findAccessibleResources({
      userId: user._id,
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.VIEW,
    })
  ).map(String);

const entriesOf = (user, agent) =>
  models.AclEntry.find({
    principalType: PrincipalType.USER,
    principalId: user._id,
    resourceType: ResourceType.AGENT,
    resourceId: agent._id,
  }).lean();

describe('design agents follow the hub permission', () => {
  const access = () => parseAgentAccess(undefined);
  let owner;
  let main;
  let beta;

  beforeAll(async () => {
    owner = await createUser({ role: SystemRoles.ADMIN });
    main = await createAgent('agent_etus_design', owner._id);
    beta = await createAgent('agent_etus_design_harness', owner._id);
  });

  it('grants view and use, not edit, to whoever holds projects.use', async () => {
    const person = await createUser();
    expect(await visibleAgents(person)).not.toContain(main._id.toString());

    expect(
      await applyAgentAccess(person._id.toString(), new Set(['projects.use']), access()),
    ).toEqual({ granted: 1, revoked: 0 });
    expect(await visibleAgents(person)).toContain(main._id.toString());
    expect(await visibleAgents(person)).not.toContain(beta._id.toString());
    const [entry] = await entriesOf(person, main);
    expect(entry.permBits).toBe(PermissionBits.VIEW);
    expect(entry.grantedBy.toString()).toBe(AGENT_ACCESS_MARKER.toString());

    expect(
      await applyAgentAccess(person._id.toString(), new Set(['projects.use']), access()),
    ).toEqual({ granted: 0, revoked: 0 });
  });

  it('shows the beta agent only with harness.beta and takes both back when the permissions go', async () => {
    const person = await createUser();
    await applyAgentAccess(
      person._id.toString(),
      new Set(['projects.use', 'harness.beta']),
      access(),
    );
    expect(await visibleAgents(person)).toEqual(
      expect.arrayContaining([main._id.toString(), beta._id.toString()]),
    );

    expect(
      await applyAgentAccess(person._id.toString(), new Set(['projects.use']), access()),
    ).toEqual({ granted: 0, revoked: 1 });
    expect(await visibleAgents(person)).not.toContain(beta._id.toString());

    expect(await applyAgentAccess(person._id.toString(), new Set(), access())).toEqual({
      granted: 0,
      revoked: 1,
    });
    expect(await visibleAgents(person)).not.toContain(main._id.toString());
  });

  it('never downgrades nor removes a share someone made by hand', async () => {
    const person = await createUser();
    await grantPermission({
      principalType: PrincipalType.USER,
      principalId: person._id,
      resourceType: ResourceType.AGENT,
      resourceId: main._id,
      accessRoleId: AccessRoleIds.AGENT_EDITOR,
      grantedBy: owner._id,
    });

    await applyAgentAccess(person._id.toString(), new Set(['projects.use']), access());
    await applyAgentAccess(person._id.toString(), new Set(), access());

    const [entry] = await entriesOf(person, main);
    expect(entry.grantedBy.toString()).toBe(owner._id.toString());
    expect(entry.permBits & PermissionBits.EDIT).toBe(PermissionBits.EDIT);
    expect(await visibleAgents(person)).toContain(main._id.toString());
  });

  it('leaves the shares the hub made to groups alone', async () => {
    const person = await createUser();
    const group = await models.Group.create({
      name: 'Design',
      source: 'local',
      memberIds: [person._id.toString()],
    });
    await models.User.updateOne({ _id: person._id }, { $set: { groups: [group._id] } });
    await grantPermission({
      principalType: PrincipalType.GROUP,
      principalId: group._id,
      resourceType: ResourceType.AGENT,
      resourceId: main._id,
      accessRoleId: AccessRoleIds.AGENT_VIEWER,
      grantedBy: SYNC_MARKER,
    });

    await applyAgentAccess(person._id.toString(), new Set(['projects.use']), access());
    await applyAgentAccess(person._id.toString(), new Set(), access());

    const groupEntries = await models.AclEntry.find({
      principalType: PrincipalType.GROUP,
      principalId: group._id,
      resourceId: main._id,
    }).lean();
    expect(groupEntries).toHaveLength(1);
    expect(groupEntries[0].grantedBy.toString()).toBe(SYNC_MARKER.toString());
    expect(await visibleAgents(person)).toContain(main._id.toString());
  });

  it('keeps the author as owner of the agent', async () => {
    await grantPermission({
      principalType: PrincipalType.USER,
      principalId: owner._id,
      resourceType: ResourceType.AGENT,
      resourceId: main._id,
      accessRoleId: AccessRoleIds.AGENT_OWNER,
      grantedBy: owner._id,
    });
    await applyAgentAccess(owner._id.toString(), new Set(['projects.use']), access());
    await applyAgentAccess(owner._id.toString(), new Set(), access());

    const [entry] = await entriesOf(owner, main);
    expect(entry.grantedBy.toString()).toBe(owner._id.toString());
    expect(entry.permBits & PermissionBits.DELETE).toBe(PermissionBits.DELETE);
  });

  it('takes back an agent removed from the configuration', async () => {
    const person = await createUser();
    await applyAgentAccess(person._id.toString(), new Set(['harness.beta']), access());
    expect(await visibleAgents(person)).toContain(beta._id.toString());

    await applyAgentAccess(
      person._id.toString(),
      new Set(['harness.beta']),
      parseAgentAccess('agent_etus_design:projects.use'),
    );
    expect(await visibleAgents(person)).not.toContain(beta._id.toString());
  });
});
