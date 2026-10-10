import { Types } from 'mongoose';
import { SkillsScope } from 'librechat-data-provider';
import { resolveAgentScopedSkillIds, resolveSkillCatalog } from '../skills';

const viewerId = new Types.ObjectId().toString();
const syncedAuthor = new Types.ObjectId();
const syncedA = { _id: new Types.ObjectId(), name: 'tpl-saas-landing', author: syncedAuthor };
const syncedB = { _id: new Types.ObjectId(), name: 'etus-design-systems', author: syncedAuthor };
const unshared = { _id: new Types.ObjectId(), name: 'private-skill', author: new Types.ObjectId() };
const deploymentSkill = {
  _id: new Types.ObjectId(),
  name: 'deployment-skill',
  author: new Types.ObjectId(),
  deployment: true,
};
const allSkills = [syncedA, syncedB, unshared, deploymentSkill];

const listSkillsByAccess = async ({ accessibleIds }: { accessibleIds: Types.ObjectId[] }) => {
  const allowed = new Set(accessibleIds.map((id) => id.toString()));
  return {
    skills: allSkills
      .filter((s) => allowed.has(s._id.toString()))
      .map((s) => ({ ...s, description: `${s.name} description`, disableModelInvocation: false })),
    has_more: false,
    after: null,
  };
};

const savedAgent = {
  id: 'agent_etus_design',
  skills_enabled: true,
  skills_scope: SkillsScope.selected,
  skills: [syncedA._id.toString(), syncedB._id.toString(), unshared._id.toString()],
};

async function catalogFor(params: {
  accessible: Types.ObjectId[];
  skillStates?: Record<string, boolean>;
  defaultActiveOnShare?: boolean;
}) {
  const scoped = resolveAgentScopedSkillIds({
    agent: savedAgent,
    accessibleSkillIds: params.accessible,
    skillsCapabilityEnabled: true,
    ephemeralSkillsToggle: false,
  });
  const catalog = await resolveSkillCatalog({
    accessibleSkillIds: scoped,
    listSkillsByAccess: listSkillsByAccess as never,
    userId: viewerId,
    skillStates: params.skillStates,
    defaultActiveOnShare: params.defaultActiveOnShare,
  });
  return catalog.activeSkills.map((s) => s.name).sort();
}

describe('A0 spike: skills listed on a saved agent', () => {
  const publiclyViewable = [syncedA._id, syncedB._id, deploymentSkill._id];

  it('drops skills the viewer has no VIEW ACL on, even when the agent lists them', async () => {
    const names = await catalogFor({ accessible: publiclyViewable, defaultActiveOnShare: true });
    expect(names).not.toContain('private-skill');
  });

  it('drops shared skills when defaultActiveOnShare is false and the viewer has no skillStates', async () => {
    const names = await catalogFor({ accessible: publiclyViewable, defaultActiveOnShare: false });
    expect(names).toEqual([]);
  });

  it('keeps shared skills when defaultActiveOnShare is true', async () => {
    const names = await catalogFor({ accessible: publiclyViewable, defaultActiveOnShare: true });
    expect(names).toEqual(['etus-design-systems', 'tpl-saas-landing']);
  });

  it('keeps shared skills the viewer explicitly activated, with defaultActiveOnShare false', async () => {
    const names = await catalogFor({
      accessible: publiclyViewable,
      defaultActiveOnShare: false,
      skillStates: { [syncedA._id.toString()]: true },
    });
    expect(names).toEqual(['tpl-saas-landing']);
  });

  it('honours an explicit false in skillStates even with defaultActiveOnShare true', async () => {
    const names = await catalogFor({
      accessible: publiclyViewable,
      defaultActiveOnShare: true,
      skillStates: { [syncedB._id.toString()]: false },
    });
    expect(names).toEqual(['tpl-saas-landing']);
  });

  it('ignores skills that are accessible but not on the agent list', async () => {
    const names = await catalogFor({
      accessible: publiclyViewable,
      defaultActiveOnShare: true,
    });
    expect(names).not.toContain('deployment-skill');
  });

  it('exposes no skills when skills_enabled is not true', () => {
    const scoped = resolveAgentScopedSkillIds({
      agent: { ...savedAgent, skills_enabled: undefined },
      accessibleSkillIds: publiclyViewable,
      skillsCapabilityEnabled: true,
      ephemeralSkillsToggle: false,
    });
    expect(scoped).toEqual([]);
  });

  it('exposes no skills when the skills capability is off on the agents endpoint', () => {
    const scoped = resolveAgentScopedSkillIds({
      agent: savedAgent,
      accessibleSkillIds: publiclyViewable,
      skillsCapabilityEnabled: false,
      ephemeralSkillsToggle: false,
    });
    expect(scoped).toEqual([]);
  });
});
