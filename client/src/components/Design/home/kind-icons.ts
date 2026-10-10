import {
  FileText,
  Image,
  MonitorSmartphone,
  Presentation,
  Shapes,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectKind } from '../api/types';

export const PROJECT_KIND_ICONS: Record<ProjectKind, LucideIcon> = {
  prototype: MonitorSmartphone,
  deck: Presentation,
  doc: FileText,
  image: Image,
  video: Video,
  other: Shapes,
};
