const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { skillSyncConfigSchema } = require('librechat-data-provider');
const {
  partitionIssues,
  validateSkillName,
  validateSkillBody,
  validateSkillFrontmatter,
  validateSkillDescription,
} = require('@librechat/data-schemas');
const { createGitHubSkillSyncRunner, isSafeSkillFilePath } = require('@librechat/api');
const { startMemoryDb, createUser } = require('../test-utils');

jest.mock('../../connect', () => jest.fn().mockResolvedValue(true));

const FIXTURES = path.join(__dirname, 'fixtures');
const DIST_DIR = path.resolve(process.env.ETUS_DESIGN_DIST_DIR || path.join(FIXTURES, 'dist'));
const AGENT_FILE = path.resolve(
  process.env.ETUS_DESIGN_AGENT_FILE || path.join(FIXTURES, 'etus-design.agent.json'),
);
const REPO_SKILLS_PATH = 'design-assets/dist/skills';
const TOKEN_ENV = 'ETUS_DIST_VALIDATION_TOKEN';

const SYNC_CONFIG = skillSyncConfigSchema.parse({
  github: {
    enabled: true,
    intervalMinutes: 60,
    runOnStartup: true,
    sources: [
      {
        id: 'etus-design',
        owner: 'evolution-foundation',
        repo: 'etus-design',
        ref: 'main',
        paths: [REPO_SKILLS_PATH],
        skillDiscoveryDepth: 1,
        token: `\${${TOKEN_ENV}}`,
      },
    ],
  },
});

function gitBlobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function listTree(rootDir) {
  const entries = [];
  const walk = (dir) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, dirent.name);
      const repoPath = `${REPO_SKILLS_PATH}/${path.relative(rootDir, absolute).split(path.sep).join('/')}`;
      if (dirent.isDirectory()) {
        entries.push({ path: repoPath, type: 'tree', id: `tree:${repoPath}` });
        walk(absolute);
      } else if (dirent.isFile()) {
        const content = fs.readFileSync(absolute);
        entries.push({
          path: repoPath,
          type: 'blob',
          id: gitBlobSha(content),
          size: content.length,
          absolute,
        });
      }
    }
  };
  walk(rootDir);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function createLocalDistAdapter(skillsDir) {
  const entries = listTree(skillsDir);
  const byId = new Map(
    entries.filter((entry) => entry.type === 'blob').map((entry) => [entry.id, entry]),
  );
  return {
    resolveCommit: async () => ({ id: 'local-dist', treeId: 'local-dist-tree' }),
    fetchTreeEntries: async (_commit, { pathPrefix }) =>
      entries
        .filter((entry) => !pathPrefix || entry.path.startsWith(`${pathPrefix}/`))
        .map(({ absolute: _absolute, ...entry }) => entry),
    fetchFileContent: async (_commit, entry) => fs.readFileSync(byId.get(entry.id).absolute),
  };
}

function skillDirectories(skillsDir) {
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => fs.existsSync(path.join(skillsDir, dirent.name, 'SKILL.md')))
    .map((dirent) => dirent.name)
    .sort();
}

function createRunner(db, skillsDir) {
  return createGitHubSkillSyncRunner({
    getConfig: () => SYNC_CONFIG,
    getCredentialToken: db.getSkillSyncCredentialToken,
    getCredentialSummary: db.getSkillSyncCredentialSummary,
    listCredentials: db.listSkillSyncCredentials,
    listStatuses: db.listSkillSyncStatuses,
    upsertStatus: db.upsertSkillSyncStatus,
    tryAcquireLock: db.tryAcquireSkillSyncLock,
    refreshLock: db.refreshSkillSyncLock,
    releaseLock: db.releaseSkillSyncLock,
    createSkill: db.createSkill,
    updateSkill: db.updateSkill,
    getSkillById: db.getSkillById,
    findSkillBySourceIdentity: db.findSkillBySourceIdentity,
    listSkillsBySource: db.listSkillsBySource,
    listSkillFiles: db.listSkillFiles,
    getSkillFileByPath: db.getSkillFileByPath,
    upsertSkillFile: db.upsertSkillFile,
    deleteSkillFile: db.deleteSkillFile,
    deleteSkill: db.deleteSkill,
    grantPermission: async ({
      principalType,
      principalId,
      resourceType,
      resourceId,
      accessRoleId,
      grantedBy,
    }) => {
      const role = await db.findRoleByIdentifier(accessRoleId);
      return db.grantPermission(
        principalType,
        principalId,
        resourceType,
        resourceId,
        role.permBits,
        grantedBy,
        undefined,
        role._id,
      );
    },
    saveBuffer: async ({ userId, fileName }) => ({
      filepath: `/uploads/${userId}/${fileName}`,
      source: 'local',
    }),
    deleteFile: async () => undefined,
    createAdapter: () => createLocalDistAdapter(skillsDir),
  });
}

describe('dist validation', () => {
  const skillsDir = path.join(DIST_DIR, 'skills');
  let env;
  let db;

  async function syncDist(dir) {
    await env.clear(['Skill', 'SkillFile', 'AclEntry', 'SkillSyncStatus']);
    const result = await createRunner(db, dir).runOnce();
    return { result, status: result.sources.find((source) => source.sourceId === 'etus-design') };
  }

  beforeAll(async () => {
    process.env[TOKEN_ENV] = 'local-dist-validation';
    env = await startMemoryDb();
    db = env.db;
  });

  afterAll(async () => {
    delete process.env[TOKEN_ENV];
    await env?.stop();
  });

  describe(`skills in ${DIST_DIR}`, () => {
    let sync;

    beforeAll(async () => {
      if (!fs.existsSync(skillsDir)) {
        throw new Error(`${skillsDir} does not exist; point ETUS_DESIGN_DIST_DIR at a dist folder`);
      }
      sync = await syncDist(skillsDir);
    }, 300000);

    it('syncs every skill through the real skillSync runner without skips', () => {
      expect(sync.status.skippedSkills ?? []).toEqual([]);
      expect(sync.status.skippedFiles ?? []).toEqual([]);
      expect(sync.result.status).toBe('completed');
      expect(sync.status).toMatchObject({
        status: 'succeeded',
        skippedSkillCount: 0,
        skippedFileCount: 0,
        syncedSkillCount: skillDirectories(skillsDir).length,
      });
    });

    it('stores skills that pass the LibreChat skill validators', async () => {
      const skills = await db.listSkillsBySource({ source: 'github', sourceId: 'etus-design' });
      expect(skills.map((skill) => skill.name).sort()).toEqual(skillDirectories(skillsDir));
      const problems = [];
      for (const skill of skills) {
        const { errors } = partitionIssues([
          ...validateSkillName(skill.name),
          ...validateSkillDescription(skill.description),
          ...validateSkillBody(skill.body),
          ...validateSkillFrontmatter(skill.frontmatter),
        ]);
        errors.forEach((issue) => problems.push(`${skill.name}: ${issue.field} ${issue.message}`));
        const files = await db.listSkillFiles(skill._id);
        files
          .filter((file) => !isSafeSkillFilePath(file.relativePath))
          .forEach((file) => problems.push(`${skill.name}: unsafe path ${file.relativePath}`));
      }
      expect(problems).toEqual([]);
    });

    it('mirrors every supporting file of every skill', async () => {
      const skills = await db.listSkillsBySource({ source: 'github', sourceId: 'etus-design' });
      let mirrored = 0;
      for (const skill of skills) {
        mirrored += (await db.listSkillFiles(skill._id)).length;
      }
      const onDisk = listTree(skillsDir).filter(
        (entry) => entry.type === 'blob' && path.basename(entry.path) !== 'SKILL.md',
      ).length;
      expect(mirrored).toBe(onDisk);
    });

    it('resolves every skill of the agent definition against the synced skills', async () => {
      const { seedDesignAgent } = require('../seed-design-agent');
      const author = await createUser(env.models, 'dist-validation@etus.test');
      const definition = JSON.parse(fs.readFileSync(AGENT_FILE, 'utf8'));

      const result = await seedDesignAgent({ definition, author, dryRun: true });

      expect(result.missingSkills).toEqual([]);
      expect(result.skillIds).toHaveLength(definition.skillNames.length);
    });
  });

  it('accepts prompts.json with the importer schema', () => {
    const promptsFile = path.join(DIST_DIR, 'prompts', 'prompts.json');
    if (!fs.existsSync(promptsFile)) {
      return;
    }
    const { parsePromptsFile } = require('../import-prompts');
    const parsed = parsePromptsFile(JSON.parse(fs.readFileSync(promptsFile, 'utf8')));
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it('reports invalid skills, so a broken dist cannot pass', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'etus-dist-'));
    const write = (name, content) => {
      fs.mkdirSync(path.join(broken, name));
      fs.writeFileSync(path.join(broken, name, 'SKILL.md'), content);
    };
    try {
      write(
        'claude-helper',
        '---\nname: claude-helper\ndescription: Uses a reserved prefix, so LibreChat must refuse it.\n---\nbody\n',
      );
      write('bad-yaml', '---\nname: bad-yaml\ndescription: [unclosed\n---\nbody\n');
      write(
        'good-one',
        '---\nname: good-one\ndescription: A valid skill that says when it should be used.\n---\nbody\n',
      );

      const { status } = await syncDist(broken);

      expect(status.syncedSkillCount).toBe(1);
      expect(status.skippedSkillCount).toBe(2);
      expect(status.skippedSkills.map((skill) => skill.path).sort()).toEqual([
        `${REPO_SKILLS_PATH}/bad-yaml`,
        `${REPO_SKILLS_PATH}/claude-helper`,
      ]);
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });
});
