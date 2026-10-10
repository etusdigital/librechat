import {
  FileAudio,
  FileCode,
  FileImage,
  FileQuestion,
  FileText,
  FileVideo,
  Globe,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FileKind } from './file-kind';

export const FILE_KIND_ICONS: Record<FileKind, LucideIcon> = {
  html: Globe,
  markdown: FileText,
  code: FileCode,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  binary: FileQuestion,
};
