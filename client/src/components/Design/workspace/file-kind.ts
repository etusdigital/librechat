export type FileKind = 'html' | 'markdown' | 'code' | 'image' | 'video' | 'audio' | 'binary';

const CODE_EXTENSIONS: Record<string, string> = {
  css: 'css',
  scss: 'scss',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  svg: 'xml',
  xml: 'xml',
  txt: 'plaintext',
  csv: 'plaintext',
  yaml: 'yaml',
  yml: 'yaml',
};

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'ico',
  'bmp',
]);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']);

export function extensionOf(path: string) {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKindOf(path: string, mime = ''): FileKind {
  const extension = extensionOf(path);
  const type = mime.split(';')[0].trim().toLowerCase();
  if (extension === 'html' || extension === 'htm' || type === 'text/html') {
    return 'html';
  }
  if (extension === 'md' || extension === 'markdown' || type === 'text/markdown') {
    return 'markdown';
  }
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }
  if (type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (extension in CODE_EXTENSIONS || type.startsWith('text/') || type.endsWith('json')) {
    return 'code';
  }
  return 'binary';
}

export function codeLanguageOf(path: string) {
  const extension = extensionOf(path);
  if (extension === 'html' || extension === 'htm') {
    return 'xml';
  }
  if (extension === 'md' || extension === 'markdown') {
    return 'markdown';
  }
  return CODE_EXTENSIONS[extension] ?? 'plaintext';
}

export function fileNameOf(path: string) {
  return path.split('/').pop() || path;
}

export function directoryOf(path: string) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
