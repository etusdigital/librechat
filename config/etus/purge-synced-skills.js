const { SeedError, parseCliArgs, runCli } = require('./script-utils');

const SOURCE_PROVIDER = 'github';
const SOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function toStoredFile(file) {
  return {
    file_id: file.file_id,
    filepath: file.filepath,
    source: file.source,
    storageKey: file.storageKey,
    storageRegion: file.storageRegion,
    user: file.author,
    tenantId: file.tenantId,
  };
}

async function purgeSyncedSkills({ sourceId, dryRun = false, deleteStoredFile }) {
  if (!sourceId || !SOURCE_ID_PATTERN.test(sourceId)) {
    throw new SeedError('Pass --source with the skillSync source id (for example etus-design)');
  }
  const db = require('~/models');
  const skills = await db.listSkillsBySource({ source: SOURCE_PROVIDER, sourceId });
  const result = {
    dryRun,
    sourceId,
    skills: skills.map((skill) => skill.name),
    fileCount: 0,
    storageErrors: [],
    incomplete: [],
  };

  for (const skill of skills) {
    const files = await db.listSkillFiles(skill._id);
    result.fileCount += files.length;
    if (dryRun) {
      continue;
    }
    const deletion = await db.deleteSkill(skill._id.toString());
    if (!deletion.cleanupComplete) {
      result.incomplete.push(`${skill.name} (${deletion.failedCleanupSteps.join(', ')})`);
    }
    if (!deleteStoredFile || deletion.failedCleanupSteps.includes('skill_files')) {
      continue;
    }
    for (const file of files) {
      try {
        await deleteStoredFile(toStoredFile(file));
      } catch (error) {
        result.storageErrors.push(`${skill.name}/${file.relativePath}: ${error.message}`);
      }
    }
  }
  return result;
}

async function createStoredFileRemover() {
  const { getAppConfig } = require('~/server/services/Config');
  const { getStrategyFunctions } = require('~/server/services/Files/strategies');
  const appConfig = await getAppConfig({ baseOnly: true });
  return async (file) => {
    const strategy = getStrategyFunctions(file.source);
    if (!strategy.deleteFile) {
      return;
    }
    const userId = file.user?.toString();
    await strategy.deleteFile(
      { config: appConfig, user: { id: userId, _id: userId, tenantId: file.tenantId } },
      file,
    );
  };
}

const CLI_OPTIONS = {
  source: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
};

async function main(argv) {
  const args = parseCliArgs(argv, CLI_OPTIONS);
  const dryRun = args['dry-run'];
  const deleteStoredFile = dryRun ? undefined : await createStoredFileRemover();
  const result = await purgeSyncedSkills({ sourceId: args.source, dryRun, deleteStoredFile });
  const prefix = dryRun ? '[dry-run] ' : '';
  console.log(
    `${prefix}source ${result.sourceId}: ${result.skills.length} skills, ${result.fileCount} files`,
  );
  result.skills.forEach((name) => console.log(`  - ${name}`));
  result.incomplete.forEach((entry) => console.warn(`  cleanup incomplete: ${entry}`));
  result.storageErrors.forEach((entry) => console.warn(`  storage: ${entry}`));
  if (!dryRun && result.skills.length > 0) {
    console.log('Disable the source in skillSync, or the next sync recreates these skills.');
  }
  if (result.incomplete.length > 0) {
    throw new SeedError('Some skills were not fully cleaned up; run the purge again');
  }
}

if (require.main === module) {
  runCli(main);
}

module.exports = { purgeSyncedSkills, main };
