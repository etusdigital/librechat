const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SYNCED_AUTHOR_ID = new mongoose.Types.ObjectId('5eed00000000000000000001');

async function startMemoryDb() {
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  const models = require('~/db/models');
  const db = require('~/models');
  await db.seedDefaultRoles();
  return {
    db,
    models,
    async stop() {
      await mongoose.disconnect();
      await server.stop();
    },
    async clear(collections) {
      const { models } = mongoose.connection;
      await Promise.all(collections.map((name) => models[name].deleteMany({})));
    },
  };
}

async function createUser(models, email, extra = {}) {
  return models.User.create({
    name: email.split('@')[0],
    email,
    username: email.split('@')[0],
    emailVerified: true,
    provider: 'local',
    role: 'ADMIN',
    ...extra,
  });
}

async function insertSyncedSkill(models, name, { sourceId = 'etus-design', files = [] } = {}) {
  const skill = await models.Skill.create({
    name,
    description: `${name} description long enough to describe when the skill should be used.`,
    body: `---\nname: ${name}\ndescription: ${name}\n---\nbody`,
    author: SYNCED_AUTHOR_ID,
    authorName: 'System',
    source: 'github',
    sourceMetadata: {
      provider: 'github',
      sourceId,
      upstreamId: `${sourceId}:design-assets/dist/skills/${name}`,
      owner: 'evolution-foundation',
      repo: 'etus-design',
    },
  });
  for (const relativePath of files) {
    await models.SkillFile.create({
      skillId: skill._id,
      relativePath,
      file_id: `${name}-${relativePath}`,
      filename: relativePath.split('/').pop(),
      filepath: `/uploads/${SYNCED_AUTHOR_ID}/${name}-${relativePath.replace(/\//g, '_')}`,
      source: 'local',
      mimeType: 'text/markdown',
      bytes: 10,
      author: SYNCED_AUTHOR_ID,
    });
  }
  return skill;
}

module.exports = { SYNCED_AUTHOR_ID, startMemoryDb, createUser, insertSyncedSkill };
