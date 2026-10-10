const { canAuthorSkillFiles } = require('../skillDeps');

const enabled = { skillsCapabilityEnabled: true, skillCreateAllowed: true };

describe('skill authoring opt-out per agent', () => {
  it('keeps authoring for an agent with skills when the field is not set', () => {
    const agent = { id: 'agent_a', skills_enabled: true };
    expect(canAuthorSkillFiles({ agent, ...enabled })).toBe(true);
  });

  it('drops authoring when the agent sets skill_authoring_enabled to false', () => {
    const agent = { id: 'agent_etus_design', skills_enabled: true, skill_authoring_enabled: false };
    expect(canAuthorSkillFiles({ agent, ...enabled })).toBe(false);
  });

  it('still allows authoring-only agents', () => {
    const agent = { id: 'agent_b', skill_authoring_enabled: true };
    expect(canAuthorSkillFiles({ agent, ...enabled })).toBe(true);
  });
});
