jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../settingsCache', () => ({
  readHubSkills: jest.fn(),
  writeHubSkills: jest.fn(),
}));
jest.mock('~/models', () => ({
  getUserById: jest.fn(),
  updateUser: jest.fn(),
}));

const mongoose = require('mongoose');
const { MAX_SKILL_STATES } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { readHubSkills, writeHubSkills } = require('../settingsCache');
const db = require('~/models');
const { grantedSkillIds, planSkillActivation, syncHubSkills } = require('../skillActivation');

const skillId = (index) => `64c${String(index).padStart(21, '0')}`;
const lean = (value) => ({ lean: async () => value });

describe('planSkillActivation', () => {
  it('turns on granted skills that have no explicit state', () => {
    const plan = planSkillActivation({
      states: {},
      granted: [skillId(1), skillId(2)],
      activated: [],
    });
    expect(plan.states).toEqual({ [skillId(1)]: true, [skillId(2)]: true });
    expect(plan.activated).toEqual([skillId(1), skillId(2)]);
    expect(plan.changed).toBe(true);
  });

  it('never overwrites an explicit false the person chose', () => {
    const plan = planSkillActivation({
      states: { [skillId(1)]: false },
      granted: [skillId(1), skillId(2)],
      activated: [],
    });
    expect(plan.states).toEqual({ [skillId(1)]: false, [skillId(2)]: true });
    expect(plan.activated).toEqual([skillId(2)]);
  });

  it('stops tracking a hub skill the person turned off, so revoking keeps the false', () => {
    const turnedOff = planSkillActivation({
      states: { [skillId(1)]: false },
      granted: [skillId(1)],
      activated: [skillId(1)],
    });
    expect(turnedOff.activated).toEqual([]);
    expect(turnedOff.changed).toBe(false);

    const revoked = planSkillActivation({
      states: turnedOff.states,
      granted: [],
      activated: turnedOff.activated,
    });
    expect(revoked.states).toEqual({ [skillId(1)]: false });
  });

  it('removes only the states the hub turned on when the grant goes away', () => {
    const plan = planSkillActivation({
      states: { [skillId(1)]: true, [skillId(2)]: true, [skillId(3)]: true },
      granted: [skillId(3)],
      activated: [skillId(1), skillId(3)],
    });
    expect(plan.states).toEqual({ [skillId(2)]: true, [skillId(3)]: true });
    expect(plan.activated).toEqual([skillId(3)]);
    expect(plan.changed).toBe(true);
  });

  it('leaves a skill the person turned on alone, even after the hub stops granting it', () => {
    const granted = planSkillActivation({
      states: { [skillId(1)]: true },
      granted: [skillId(1)],
      activated: [],
    });
    expect(granted.activated).toEqual([]);
    expect(granted.changed).toBe(false);

    const revoked = planSkillActivation({ states: granted.states, granted: [], activated: [] });
    expect(revoked.states).toEqual({ [skillId(1)]: true });
  });

  it('turns a granted skill back on when its state was cleared', () => {
    const plan = planSkillActivation({
      states: {},
      granted: [skillId(1)],
      activated: [skillId(1)],
    });
    expect(plan.states).toEqual({ [skillId(1)]: true });
    expect(plan.activated).toEqual([skillId(1)]);
  });

  it('respects the 200 skill state limit and reports what was left out', () => {
    expect(MAX_SKILL_STATES).toBe(200);
    const states = Object.fromEntries(
      Array.from({ length: 195 }, (_, index) => [skillId(index), index % 2 === 0]),
    );
    const granted = Array.from({ length: 10 }, (_, index) => skillId(1000 + index));

    const plan = planSkillActivation({ states, granted, activated: [] });

    expect(Object.keys(plan.states)).toHaveLength(MAX_SKILL_STATES);
    expect(plan.activated).toEqual(granted.slice(0, 5));
    expect(plan.skipped).toEqual(granted.slice(5));
  });

  it('frees room from revoked skills before adding new ones at the limit', () => {
    const states = Object.fromEntries(
      Array.from({ length: MAX_SKILL_STATES }, (_, index) => [skillId(index), true]),
    );
    const plan = planSkillActivation({
      states,
      granted: [skillId(5000)],
      activated: [skillId(0)],
    });
    expect(Object.keys(plan.states)).toHaveLength(MAX_SKILL_STATES);
    expect(plan.states[skillId(0)]).toBeUndefined();
    expect(plan.states[skillId(5000)]).toBe(true);
    expect(plan.skipped).toEqual([]);
  });
});

describe('hub skill activation', () => {
  const saved = {};
  const agentDocs = [
    {
      id: 'agent_etus_design',
      skills: [skillId(2), skillId(3)],
      skills_scope: 'selected',
    },
    { id: 'agent_off', skills: [skillId(9)], skills_scope: 'none' },
  ];

  beforeAll(() => {
    saved.Agent = mongoose.models.Agent;
    saved.Skill = mongoose.models.Skill;
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
    mongoose.models.Agent = { find: jest.fn(() => lean(agentDocs)) };
    mongoose.models.Skill = {
      find: jest.fn((filter) =>
        lean(
          filter._id.$in
            .filter((id) => id !== skillId(404))
            .map((id) => ({ _id: { toString: () => id } })),
        ),
      ),
    };
    readHubSkills.mockResolvedValue([]);
    db.getUserById.mockResolvedValue({ skillStates: { [skillId(3)]: false } });
  });

  it('grants the union of hub skills and the skills of granted agents', async () => {
    const granted = await grantedSkillIds({
      skills: [skillId(1), skillId(2), skillId(404), 'bad-id'],
      agents: ['agent_etus_design', 'agent_off'],
    });

    expect(mongoose.models.Agent.find).toHaveBeenCalledWith(
      { id: { $in: ['agent_etus_design', 'agent_off'] }, skills_enabled: true },
      expect.anything(),
    );
    expect(granted).toEqual([skillId(1), skillId(2), skillId(3)]);
  });

  it('skips the database when nothing is granted', async () => {
    expect(await grantedSkillIds({})).toEqual([]);
    expect(mongoose.models.Agent.find).not.toHaveBeenCalled();
    expect(mongoose.models.Skill.find).not.toHaveBeenCalled();
  });

  it('writes the new states and remembers what the hub turned on', async () => {
    const plan = await syncHubSkills('user-1', {
      skills: [skillId(1)],
      agents: ['agent_etus_design'],
    });

    expect(db.updateUser).toHaveBeenCalledWith('user-1', {
      skillStates: { [skillId(1)]: true, [skillId(2)]: true, [skillId(3)]: false },
    });
    expect(writeHubSkills).toHaveBeenCalledWith('user-1', [skillId(1), skillId(2)]);
    expect(plan.skipped).toEqual([]);
  });

  it('turns off what the hub turned on when the person loses access', async () => {
    readHubSkills.mockResolvedValue([skillId(1), skillId(2)]);
    db.getUserById.mockResolvedValue({
      skillStates: { [skillId(1)]: true, [skillId(2)]: true, [skillId(3)]: false },
    });

    await syncHubSkills('user-1', {});

    expect(db.updateUser).toHaveBeenCalledWith('user-1', {
      skillStates: { [skillId(3)]: false },
    });
    expect(writeHubSkills).toHaveBeenCalledWith('user-1', []);
  });

  it('does not write the user when nothing changed', async () => {
    readHubSkills.mockResolvedValue([skillId(1)]);
    db.getUserById.mockResolvedValue({ skillStates: { [skillId(1)]: true } });

    await syncHubSkills('user-1', { skills: [skillId(1)] });

    expect(db.updateUser).not.toHaveBeenCalled();
    expect(writeHubSkills).toHaveBeenCalledWith('user-1', [skillId(1)]);
  });

  it('does nothing without grants or earlier activations', async () => {
    expect(await syncHubSkills('user-1', {})).toBeNull();
    expect(db.getUserById).not.toHaveBeenCalled();
    expect(writeHubSkills).not.toHaveBeenCalled();
  });

  it('waits for the next pass when the activation cache cannot be read', async () => {
    readHubSkills.mockResolvedValue(null);
    expect(await syncHubSkills('user-1', { skills: [skillId(1)] })).toBeNull();
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(writeHubSkills).not.toHaveBeenCalled();
  });

  it('logs when the limit leaves hub skills out', async () => {
    db.getUserById.mockResolvedValue({
      skillStates: Object.fromEntries(
        Array.from({ length: MAX_SKILL_STATES }, (_, index) => [skillId(5000 + index), false]),
      ),
    });

    const plan = await syncHubSkills('user-1', { skills: [skillId(1)] });

    expect(plan.skipped).toEqual([skillId(1)]);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('200 skill states'));
  });

  it('never throws into the login flow', async () => {
    db.getUserById.mockRejectedValue(new Error('mongo down'));
    await expect(syncHubSkills('user-1', { skills: [skillId(1)] })).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});
