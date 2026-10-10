const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { MAX_SKILL_STATES, toSkillStatesRecord } = require('@librechat/api');
const { SkillsScope } = require('librechat-data-provider');
const { readHubSkills, writeHubSkills } = require('./settingsCache');
const db = require('~/models');

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const stringList = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

async function agentSkillIds(agentIds) {
  const { Agent } = mongoose.models;
  if (!Agent || agentIds.length === 0) {
    return [];
  }
  const agents = await Agent.find(
    { id: { $in: agentIds }, skills_enabled: true },
    { id: 1, skills: 1, skills_scope: 1 },
  ).lean();
  const order = new Map(agentIds.map((id, index) => [id, index]));
  return agents
    .filter((agent) => agent.skills_scope !== SkillsScope.none)
    .sort((a, b) => order.get(a.id) - order.get(b.id))
    .flatMap((agent) => (Array.isArray(agent.skills) ? agent.skills.map(String) : []));
}

async function grantedSkillIds(values) {
  const candidates = [
    ...new Set([
      ...stringList(values?.skills),
      ...(await agentSkillIds(stringList(values?.agents))),
    ]),
  ].filter((id) => OBJECT_ID_PATTERN.test(id));
  const { Skill } = mongoose.models;
  if (!Skill || candidates.length === 0) {
    return [];
  }
  const existing = await Skill.find({ _id: { $in: candidates } }, { _id: 1 }).lean();
  const existingIds = new Set(existing.map((skill) => skill._id.toString()));
  return candidates.filter((id) => existingIds.has(id));
}

function planSkillActivation({ states, granted, activated, limit = MAX_SKILL_STATES }) {
  const next = { ...states };
  const grantedIds = new Set(granted);
  const tracked = new Set();
  let changed = false;

  for (const id of activated) {
    if (next[id] !== true) {
      continue;
    }
    if (grantedIds.has(id)) {
      tracked.add(id);
    } else {
      delete next[id];
      changed = true;
    }
  }

  const skipped = [];
  let size = Object.keys(next).length;
  for (const id of granted) {
    if (next[id] !== undefined) {
      continue;
    }
    if (size >= limit) {
      skipped.push(id);
      continue;
    }
    next[id] = true;
    tracked.add(id);
    size += 1;
    changed = true;
  }

  return { states: next, activated: [...tracked], skipped, changed };
}

async function syncHubSkills(userId, values) {
  try {
    const activated = await readHubSkills(userId);
    if (activated == null) {
      return null;
    }
    const granted = await grantedSkillIds(values);
    if (granted.length === 0 && activated.length === 0) {
      return null;
    }
    const user = await db.getUserById(userId, 'skillStates');
    if (!user) {
      return null;
    }
    const plan = planSkillActivation({
      states: toSkillStatesRecord(user.skillStates),
      granted,
      activated,
    });
    if (plan.changed) {
      await db.updateUser(userId, { skillStates: plan.states });
    }
    await writeHubSkills(userId, plan.activated);
    if (plan.skipped.length > 0) {
      logger.warn(
        `[EtusHub] User ${userId} reached ${MAX_SKILL_STATES} skill states; ${plan.skipped.length} hub skills were not activated`,
      );
    }
    return plan;
  } catch (error) {
    logger.warn(`[EtusHub] Skill activation failed for user ${userId}: ${error?.message ?? error}`);
    return null;
  }
}

module.exports = {
  grantedSkillIds,
  planSkillActivation,
  syncHubSkills,
};
