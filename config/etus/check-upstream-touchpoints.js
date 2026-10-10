#!/usr/bin/env node
const path = require('path');
const { parseArgs } = require('util');
const { execFileSync } = require('child_process');

const OWNED_PREFIXES = Object.freeze([
  'api/server/services/Etus/',
  'api/server/routes/etus/',
  'config/etus/',
  'client/src/components/Design/',
  'client/src/components/Etus/',
  'e2e/specs/etus-design/',
]);
const OWNED_FILES = Object.freeze(['.github/workflows/etus-design-e2e.yml']);
const OWNED_PATTERNS = Object.freeze([/^client\/src\/locales\/[^/]+\/etus-design\.json$/]);

const DESIGN_TOUCHPOINTS = Object.freeze([
  'client/src/routes/index.tsx',
  'client/src/hooks/Nav/useSideNavLinks.ts',
  'client/src/locales/i18n.ts',
  'api/server/index.js',
]);

const EARLIER_TOUCHPOINTS = Object.freeze([
  '.env.example',
  '.github/workflows/etus-image.yml',
  'Dockerfile',
  'api/app/clients/tools/structured/OpenAIImageTools.js',
  'api/app/clients/tools/structured/specs/OpenAIImageTools-headers.spec.js',
  'api/server/controllers/AuthController.js',
  'api/server/routes/oauth.js',
  'api/server/services/Config/app.js',
  'api/server/services/Endpoints/agents/__tests__/skillAuthoringOptOut.spec.js',
  'api/server/services/Endpoints/agents/skillDeps.js',
  'api/strategies/openidStrategy.js',
  'api/strategies/openidStrategy.spec.js',
  'client/index.html',
  'client/public/assets/apple-touch-icon-180x180.png',
  'client/public/assets/favicon-16x16.png',
  'client/public/assets/favicon-32x32.png',
  'client/public/assets/icon-192x192.png',
  'client/public/assets/logo.svg',
  'client/public/assets/maskable-icon.png',
  'client/public/fonts/SpaceGrotesk-Variable.woff2',
  'client/src/components/Auth/Login.tsx',
  'client/src/components/Auth/__tests__/Login.spec.tsx',
  'client/src/components/Chat/EtusHubButton.tsx',
  'client/src/components/Chat/Header.tsx',
  'client/src/components/Nav/AccountSettings.tsx',
  'client/src/etus.css',
  'client/src/locales/en/translation.json',
  'client/src/locales/pt-BR/translation.json',
  'client/src/main.jsx',
  'client/vite.config.ts',
  'packages/api/src/endpoints/custom/initialize.spec.ts',
  'packages/api/src/endpoints/custom/initialize.ts',
  'packages/api/src/endpoints/openai/emptyChunks.spec.ts',
  'packages/api/src/endpoints/openai/emptyChunks.ts',
]);

const UPSTREAM_TOUCHPOINTS = new Set([...DESIGN_TOUCHPOINTS, ...EARLIER_TOUCHPOINTS]);
const DEFAULT_BASE_REFS = Object.freeze(['upstream/main', 'origin/main', 'etus/main']);

class TouchpointError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TouchpointError';
  }
}

const isOwnedPath = (filePath) =>
  OWNED_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
  OWNED_FILES.includes(filePath) ||
  OWNED_PATTERNS.some((pattern) => pattern.test(filePath));

const isAllowedPath = (filePath) => isOwnedPath(filePath) || UPSTREAM_TOUCHPOINTS.has(filePath);

const findUnexpectedPaths = (filePaths) =>
  [...new Set(filePaths)].filter((filePath) => !isAllowedPath(filePath)).sort();

function createGit(cwd) {
  return (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
}

function refExists(git, ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(git, requested) {
  if (requested) {
    if (!refExists(git, requested)) {
      throw new TouchpointError(`Base ref not found: ${requested}`);
    }
    return requested;
  }
  const found = DEFAULT_BASE_REFS.find((ref) => refExists(git, ref));
  if (!found) {
    throw new TouchpointError(
      `No upstream ref found (tried ${DEFAULT_BASE_REFS.join(', ')}). Pass --base <ref> or set ETUS_UPSTREAM_REF.`,
    );
  }
  return found;
}

function changedPaths(git, base, head) {
  const mergeBase = git(['merge-base', base, head]).trim();
  const output = git(['diff', '--name-only', '--no-renames', '-z', mergeBase, head]);
  return { mergeBase, paths: output.split('\0').filter(Boolean) };
}

function checkTouchpoints({ cwd = process.cwd(), base, head = 'HEAD' } = {}) {
  const git = createGit(cwd);
  const baseRef = resolveBaseRef(git, base);
  const { mergeBase, paths } = changedPaths(git, baseRef, head);
  return { baseRef, mergeBase, changed: paths, unexpected: findUnexpectedPaths(paths) };
}

function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArgs({
      args: argv,
      options: { base: { type: 'string' }, head: { type: 'string' }, cwd: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  let result;
  try {
    result = checkTouchpoints({
      cwd: options.cwd ? path.resolve(options.cwd) : process.cwd(),
      base: options.base ?? env.ETUS_UPSTREAM_REF,
      head: options.head ?? 'HEAD',
    });
  } catch (error) {
    console.error(
      error instanceof TouchpointError ? error.message : `git failed: ${error.message}`,
    );
    return 2;
  }
  const { baseRef, mergeBase, changed, unexpected } = result;
  if (unexpected.length) {
    console.error(
      `Upstream files changed outside the Etus touchpoints (base ${baseRef}, merge-base ${mergeBase.slice(0, 9)}):`,
    );
    unexpected.forEach((filePath) => console.error(`  ${filePath}`));
    console.error(
      'Move the change into an Etus folder, or add the file to the closed list in config/etus/check-upstream-touchpoints.js with the spec change that approves it.',
    );
    return 1;
  }
  console.log(
    `ok: ${changed.length} files differ from ${baseRef} (merge-base ${mergeBase.slice(0, 9)}), all within the Etus touchpoints`,
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  OWNED_PREFIXES,
  OWNED_FILES,
  OWNED_PATTERNS,
  DESIGN_TOUCHPOINTS,
  EARLIER_TOUCHPOINTS,
  UPSTREAM_TOUCHPOINTS,
  DEFAULT_BASE_REFS,
  TouchpointError,
  isAllowedPath,
  findUnexpectedPaths,
  checkTouchpoints,
  main,
};
