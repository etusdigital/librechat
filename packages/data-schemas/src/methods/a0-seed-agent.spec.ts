import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  AccessRoleIds,
  ResourceType,
  PrincipalType,
  PermissionBits,
  SkillsScope,
} from 'librechat-data-provider';
import type { IAgent, IAclEntry } from '..';
import { createAgentMethods } from './agent';
import { createAclEntryMethods } from './aclEntry';
import { createAccessRoleMethods } from './accessRole';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let agents: ReturnType<typeof createAgentMethods>;
let acl: ReturnType<typeof createAclEntryMethods>;
let roles: ReturnType<typeof createAccessRoleMethods>;

const authorId = new mongoose.Types.ObjectId();
const syncedAuthor = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  createModels(mongoose);
  await mongoose.connect(mongoServer.getUri());
  acl = createAclEntryMethods(mongoose);
  roles = createAccessRoleMethods(mongoose);
  agents = createAgentMethods(mongoose, {
    removeAllPermissions: async () => undefined,
    getActions: async () => [],
    getSoleOwnedResourceIds: acl.getSoleOwnedResourceIds,
    getUserPrincipals: async ({ userId }) => [
      { principalType: 'user', principalId: new mongoose.Types.ObjectId(userId) },
    ],
    findAccessibleResources: acl.findAccessibleResources,
    isExternalSkillId: () => false,
  } as never);
  await roles.seedDefaultRoles();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

async function insertSyncedSkill(name: string) {
  const Skill = mongoose.models.Skill;
  const doc = await Skill.create({
    name,
    description: `${name} description`,
    body: `---\nname: ${name}\ndescription: x\n---\nbody`,
    author: syncedAuthor,
    authorName: 'System',
    source: 'github',
    sourceMetadata: {
      provider: 'github',
      sourceId: 'etus-design',
      upstreamId: `etus-design:design-assets/dist/skills/${name}`,
    },
  });
  return doc._id as mongoose.Types.ObjectId;
}

async function resolveSkillIds(names: string[]) {
  const Skill = mongoose.models.Skill;
  const found = await Skill.find(
    { source: 'github', 'sourceMetadata.sourceId': 'etus-design', name: { $in: names } },
    { _id: 1, name: 1 },
  ).lean<{ _id: mongoose.Types.ObjectId; name: string }[]>();
  const byName = new Map(found.map((s) => [s.name, s._id.toString()]));
  const missing = names.filter((n) => !byName.has(n));
  return { ids: names.map((n) => byName.get(n)).filter(Boolean) as string[], missing };
}

function agentPayload(skillIds: string[], instructions: string) {
  return {
    id: 'agent_etus_design',
    name: 'Etus Design',
    description: 'Cria landing pages, protótipos, decks, dashboards, posts, e-mails e imagens.',
    instructions,
    provider: 'ETUS AI',
    model: 'cc/claude-sonnet-5',
    model_parameters: { temperature: 0.4 },
    artifacts: 'default',
    tools: ['image_gen_oai', 'ask_user_question'],
    skills: skillIds,
    skills_enabled: true,
    skills_scope: SkillsScope.selected,
    conversation_starters: ['Crie uma landing page para o lançamento de um produto da Etus'],
    category: 'general',
  };
}

async function seed(names: string[], instructions: string) {
  const { ids, missing } = await resolveSkillIds(names);
  if (missing.length) {
    throw new Error(`missing skills: ${missing.join(', ')}`);
  }
  const payload = agentPayload(ids, instructions);
  const existing = await agents.getAgent({ id: payload.id });
  let agent: IAgent | null;
  if (existing) {
    const { id: _id, ...update } = payload;
    agent = await agents.updateAgent({ id: payload.id }, update, {
      updatingUserId: authorId.toString(),
    });
  } else {
    agent = await agents.createAgent({ ...payload, author: authorId });
  }
  const owner = await roles.findRoleByIdentifier(AccessRoleIds.AGENT_OWNER);
  await acl.grantPermission(
    PrincipalType.USER,
    authorId,
    ResourceType.AGENT,
    (agent as IAgent)._id as mongoose.Types.ObjectId,
    owner!.permBits,
    authorId,
    undefined,
    owner!._id as mongoose.Types.ObjectId,
  );
  return agent as IAgent;
}

describe('A0 spike: seeding the Etus Design agent without HTTP', () => {
  it('creates, updates with a new version, and stays idempotent', async () => {
    await insertSyncedSkill('etus-design-systems');
    await insertSyncedSkill('tpl-saas-landing');
    const names = ['etus-design-systems', 'tpl-saas-landing'];

    const first = await seed(names, 'v1 instructions');
    expect(first.tools).toEqual(['image_gen_oai', 'ask_user_question']);
    expect(first.skills).toHaveLength(2);
    expect(first.skills_enabled).toBe(true);
    expect(first.skills_scope).toBe('selected');
    expect(first.artifacts).toBe('default');

    await seed(names, 'v2 instructions');
    await seed(names, 'v2 instructions');
    const versions = await agents.getAgentVersions({ id: 'agent_etus_design' });
    expect(versions).toHaveLength(2);

    const Agent = mongoose.models.Agent as mongoose.Model<IAgent>;
    expect(await Agent.countDocuments({ id: 'agent_etus_design' })).toBe(1);

    const AclEntry = mongoose.models.AclEntry as mongoose.Model<IAclEntry>;
    const entries = await AclEntry.find({
      resourceType: ResourceType.AGENT,
      resourceId: first._id,
    }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].principalType).toBe(PrincipalType.USER);
    expect(entries[0].permBits & PermissionBits.SHARE).toBe(PermissionBits.SHARE);
  });

  it('silently prunes skill ids that do not exist, so the seed must check names first', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const created = await agents.createAgent({
      ...agentPayload([ghost], 'x'),
      id: 'agent_ghost',
      author: authorId,
    });
    expect(created.skills).toEqual([]);
    expect(created.skills_enabled).toBe(true);
  });

  it('fails the seed when a listed skill was not synced', async () => {
    await expect(seed(['etus-design-systems', 'tpl-missing'], 'v3')).rejects.toThrow(
      'missing skills: tpl-missing',
    );
  });
});
