const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const STATE_FILE = path.join(os.tmpdir(), 'etus-design-home-e2e.json');
const ETUS_DESIGN_DIR = path.resolve(
  process.env.ETUS_DESIGN_DIR ?? path.join(ROOT, '..', 'etus-design'),
);

const PORTS = {
  chat: Number(process.env.E2E_CHAT_PORT ?? 3191),
  proxy: Number(process.env.E2E_PROXY_PORT ?? 3192),
  hub: Number(process.env.E2E_HUB_PORT ?? 3193),
  design: Number(process.env.E2E_DESIGN_PORT ?? 3194),
  preview: Number(process.env.E2E_PREVIEW_PORT ?? 3195),
};

const CHAT_URL = `http://localhost:${PORTS.chat}`;
const secret = () => crypto.randomBytes(32).toString('hex');

async function waitFor(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url).catch(() => null);
    if (response && response.status < 500) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not start at ${url}`);
}

function startProcess(label, command, args, { cwd, env, logDir }) {
  const log = fs.openSync(path.join(logDir, `${label}.log`), 'a');
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', log, log],
    detached: true,
  });
  child.unref();
  return child.pid;
}

function startMongo() {
  const name = `etus-design-home-e2e-${process.pid}`;
  execFileSync('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    '127.0.0.1::27017',
    'mongo:8.0',
  ]);
  const mapping = execFileSync('docker', ['port', name, '27017/tcp']).toString().trim();
  const port = mapping.split('\n')[0].split(':').pop();
  return { name, uri: (db) => `mongodb://127.0.0.1:${port}/${db}` };
}

async function waitForMongo(name) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      execFileSync(
        'docker',
        ['exec', name, 'mongosh', '--quiet', '--eval', 'db.adminCommand("ping").ok'],
        {
          stdio: 'ignore',
        },
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('MongoDB did not start');
}

async function startStack() {
  if (!fs.existsSync(path.join(ETUS_DESIGN_DIR, 'design-service', 'src', 'main.ts'))) {
    throw new Error(`etus-design not found at ${ETUS_DESIGN_DIR} (set ETUS_DESIGN_DIR)`);
  }
  if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
    throw new Error('client/dist is missing: run `npm run build:client` first');
  }
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etus-design-home-e2e-'));
  const storageDir = path.join(logDir, 'storage');
  fs.mkdirSync(storageDir);
  const mongo = startMongo();
  const state = { logDir, container: mongo.name, pids: [], chatUrl: CHAT_URL, ports: PORTS };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  await waitForMongo(mongo.name);

  const hubUrl = `http://127.0.0.1:${PORTS.hub}`;
  state.pids.push(
    startProcess('fake-hub', process.execPath, [path.join(__dirname, 'fake-hub-server.js')], {
      cwd: ROOT,
      env: { FAKE_HUB_PORT: String(PORTS.hub) },
      logDir,
    }),
  );
  await waitFor(`${hubUrl}/.well-known/jwks.json`, 'fake hub');

  state.pids.push(
    startProcess('design-service', process.execPath, ['src/main.ts'], {
      cwd: path.join(ETUS_DESIGN_DIR, 'design-service'),
      env: {
        PORT: String(PORTS.design),
        PREVIEW_PORT: String(PORTS.preview),
        PREVIEW_BASE_URL: `${CHAT_URL}/preview`,
        PREVIEW_INTERNAL_URL: `http://127.0.0.1:${PORTS.preview}/preview`,
        MONGO_URI: mongo.uri('etus_design'),
        STORAGE_FS_ROOT: storageDir,
        ETUS_HUB_URL: hubUrl,
        ETUS_HUB_SERVICE_KEY: 'e2e-design-service-key',
        ETUS_DESIGN_ROUTER_KEY: 'e2e-unused',
        ETUS_ROUTER_URL: 'http://127.0.0.1:9',
        PREVIEW_TOKEN_SECRET: secret(),
        RENDERER_URL: 'http://127.0.0.1:9',
        RENDERER_SECRET: secret(),
        DESIGN_ASSETS_DIR: path.join(ETUS_DESIGN_DIR, 'design-assets', 'dist'),
        LOG_LEVEL: 'warn',
      },
      logDir,
    }),
  );
  await waitFor(`http://127.0.0.1:${PORTS.design}/v1/health`, 'design-service');

  state.pids.push(
    startProcess('proxy-harness', process.execPath, [path.join(__dirname, 'proxy-harness.js')], {
      cwd: path.join(ROOT, 'api'),
      env: {
        PROXY_HARNESS_PORT: String(PORTS.proxy),
        ETUS_DESIGN_URL: `http://127.0.0.1:${PORTS.design}`,
        ETUS_HUB_URL: hubUrl,
        ETUS_HUB_MCP_KEY: 'e2e-chat-mcp-key',
      },
      logDir,
    }),
  );
  await waitFor(`http://127.0.0.1:${PORTS.proxy}/api/etus/design/me`, 'design proxy harness');

  state.pids.push(
    startProcess('librechat', process.execPath, ['api/server/index.js'], {
      cwd: ROOT,
      env: {
        NODE_ENV: 'CI',
        HOST: 'localhost',
        PORT: String(PORTS.chat),
        MONGO_URI: mongo.uri('LibreChat-design-home-e2e'),
        DOMAIN_CLIENT: CHAT_URL,
        DOMAIN_SERVER: CHAT_URL,
        CREDS_KEY: crypto.randomBytes(32).toString('hex'),
        CREDS_IV: crypto.randomBytes(16).toString('hex'),
        JWT_SECRET: secret(),
        JWT_REFRESH_SECRET: secret(),
        ALLOW_REGISTRATION: 'true',
        ALLOW_EMAIL_LOGIN: 'true',
        EMAIL_HOST: '',
        SEARCH: 'false',
        NO_INDEX: 'true',
        TITLE_CONVO: 'false',
        USE_REDIS: 'false',
        LOGIN_MAX: '50',
        REGISTER_MAX: '50',
        ETUS_DESIGN_URL: '',
      },
      logDir,
    }),
  );
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  await waitFor(`${CHAT_URL}/api/config`, 'LibreChat', 180_000);
  return state;
}

function stopStack() {
  if (!fs.existsSync(STATE_FILE)) {
    return;
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  for (const pid of state.pids ?? []) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
  spawnSync('docker', ['rm', '-f', state.container], { stdio: 'ignore' });
  fs.rmSync(STATE_FILE, { force: true });
  process.stdout.write(`etus-design home e2e logs kept in ${state.logDir}\n`);
}

module.exports = { CHAT_URL, PORTS, startStack, stopStack };
