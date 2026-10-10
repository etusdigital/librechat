import { createHash } from 'crypto';
import { join, relative } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';

const DESIGN_DIR = join(__dirname, '..');
const VENDOR_DIR = join(DESIGN_DIR, 'vendor', 'open-design');
const PREVIEW_DIR = join(DESIGN_DIR, 'preview');
const PINNED_COMMIT = '802708f6c9f294347ef777b1fda49b9cbe26ef72';
const META_FILES = new Set(['NOTICE.md', 'SOURCES.json']);
const BANNED = [
  'posthog',
  'langfuse',
  'open-design.ai',
  'vela',
  'amr',
  'fetch(',
  'XMLHttpRequest',
  'sendBeacon',
  'WebSocket',
  'EventSource',
];

interface Sources {
  upstream: string;
  commit: string;
  license: string;
  files: { path: string; sha256: string; derivedFrom: { path: string }[] }[];
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const sources = JSON.parse(readFileSync(join(VENDOR_DIR, 'SOURCES.json'), 'utf8')) as Sources;

describe('vendor/open-design', () => {
  it('C-13: has no Open Design telemetry or network calls, nor does the host side of the bridge', () => {
    const scanned = [...filesUnder(VENDOR_DIR), ...filesUnder(PREVIEW_DIR)];
    expect(scanned.length).toBeGreaterThan(0);
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      for (const banned of BANNED) {
        expect({
          file: relative(DESIGN_DIR, file),
          banned,
          found: text.includes(banned.toLowerCase()),
        }).toEqual({
          file: relative(DESIGN_DIR, file),
          banned,
          found: false,
        });
      }
    }
  });

  it('C-14: LICENSE, NOTICE.md and SOURCES.json exist and point to the pinned commit', () => {
    expect(sources.upstream).toBe('https://github.com/nexu-io/open-design');
    expect(sources.commit).toBe(PINNED_COMMIT);
    expect(sources.license).toBe('Apache-2.0');
    const license = readFileSync(join(VENDOR_DIR, 'LICENSE'), 'utf8');
    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
    const notice = readFileSync(join(VENDOR_DIR, 'NOTICE.md'), 'utf8');
    expect(notice).toContain(PINNED_COMMIT);
    expect(notice).toContain('Apache-2.0');
  });

  it('C-14: every file matches the sha256 in SOURCES.json and every copied file is listed', () => {
    const listed = new Set(sources.files.map((file) => file.path));
    expect(listed.has('LICENSE')).toBe(true);
    for (const file of sources.files) {
      expect(file.derivedFrom.length).toBeGreaterThan(0);
      expect({
        path: file.path,
        sha256: sha256(readFileSync(join(VENDOR_DIR, file.path))),
      }).toEqual({
        path: file.path,
        sha256: file.sha256,
      });
    }
    const present = filesUnder(VENDOR_DIR)
      .map((file) => relative(VENDOR_DIR, file).split('\\').join('/'))
      .filter((file) => !META_FILES.has(file));
    expect(present.sort()).toEqual([...listed].sort());
  });

  it('C-14: NOTICE.md names every copied file', () => {
    const notice = readFileSync(join(VENDOR_DIR, 'NOTICE.md'), 'utf8');
    for (const file of sources.files) {
      expect(notice).toContain(`\`${file.path}\``);
    }
  });
});
