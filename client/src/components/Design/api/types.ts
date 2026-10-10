export type DesignPermission =
  | 'projects.use'
  | 'projects.share-company'
  | 'projects.share-public'
  | 'media.image'
  | 'media.video'
  | 'media.audio'
  | 'exports.pptx'
  | 'review.jury'
  | 'design-systems.set-default'
  | 'admin.all';

export interface DesignMe {
  sub: string;
  name: string;
  orgId: string;
  permissions: string[];
  defaultDesignSystem: string;
  canSetCompanyDefault?: boolean;
  companyDefaultDesignSystem?: string;
}

export type ProjectKind = 'prototype' | 'deck' | 'doc' | 'image' | 'video' | 'other';
export type ProjectScope = 'mine' | 'shared' | 'company';
export type ProjectAccess = 'owner' | 'admin' | 'shared';

export interface DesignProject {
  projectId: string;
  name: string;
  kind: ProjectKind;
  designSystemId: string;
  entryFile: string;
  templateId: string | null;
  tags: string[];
  owner: { sub: string; name: string };
  access: ProjectAccess;
  canWrite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FileEntry {
  path: string;
  mime: string;
  size: number;
  sha256: string;
  version: number;
  updatedAt: string | null;
  updatedBy: string;
}

export interface ProjectConversation {
  conversationId: string;
  updatedAt: string;
}

export interface DesignProjectDetail extends DesignProject {
  files: FileEntry[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ProjectChanges {
  items: FileEntry[];
  paths: string[];
  projectUpdatedAt: string;
  until: string;
}

export interface FileContent {
  blob: Blob;
  mime: string;
  etag: string | null;
  version: number | null;
}

export type VersionSource = 'agent' | 'inline_edit' | 'upload' | 'restore' | 'import' | 'media';

export interface FileVersion {
  versionId: string;
  path: string;
  version: number;
  sha256: string;
  size: number;
  mime: string;
  source: VersionSource;
  actorSub: string;
  via: string;
  conversationId: string | null;
  note: string | null;
  createdAt: string | null;
}

export interface FileWriteResult {
  path: string;
  version: number;
  sha256: string;
  size: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CommentAnchor {
  selector: string;
  textSnippet: string;
  rect: Rect;
  device: string;
}

export type CommentStatus = 'open' | 'resolved';

export interface DesignComment {
  commentId: string;
  projectId: string;
  path: string;
  version: number;
  anchor: CommentAnchor;
  body: string;
  authorSub: string;
  authorName: string;
  status: CommentStatus;
  resolvedBy: string | null;
  resolvedNote: string | null;
  sentToChatAt: string | null;
  createdAt: string | null;
}

export type ShareKind = 'people' | 'company' | 'public';

export interface DesignShare {
  shareId: string;
  projectId: string;
  kind: ShareKind;
  authUserIds: string[];
  expiresAt: string | null;
  createdBy: string;
  createdAt: string | null;
  revokedAt: string | null;
  url?: string;
}

export type JobType = 'export' | 'screenshot' | 'media' | 'review';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobDownload {
  url: string;
  [key: string]: unknown;
}

export interface DesignJob {
  jobId: string;
  type: JobType;
  projectId: string | null;
  status: JobStatus;
  output: Record<string, unknown> | null;
  error: unknown;
  costUsd: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  downloadUrl: string | null;
  downloads: JobDownload[];
}

export interface PreviewUrl {
  url: string;
  expiresAt: string;
}

export type TemplateKind = 'prototype' | 'deck' | 'image';

export interface DesignTemplate {
  id: string;
  name: string;
  kind: TemplateKind;
  category: string | null;
  description: string;
  license: string | null;
  previewUrl: string | null;
}

export interface DesignSystemSummary {
  id: string;
  name: string;
  category: string;
  summary: string;
  inspiredBy?: string;
  license: string | null;
  hasComponents: boolean;
  thumbnailUrl: string | null;
  swatches: string[];
  headingFont: string | null;
}

export interface DesignSystemPage extends Page<DesignSystemSummary> {
  total: number;
  categories: string[];
}

export interface TokenEntry {
  name: string;
  cssVar: string;
  value: string;
}

export interface DesignSystemTypography {
  families: (TokenEntry & { primary: string })[];
  weights: number[];
  scale: TokenEntry[];
  leading: TokenEntry[];
  tracking: TokenEntry[];
}

export interface DesignSystemDetail extends DesignSystemSummary {
  attribution: {
    origin: string | null;
    sourcePath: string | null;
    originalUpstream: string | null;
    upstreamCommit: string | null;
  };
  designMd: string | null;
  tokensCss: string | null;
  usageMd: string | null;
  componentsUrl: string | null;
  previewUrl: string | null;
  previews: { role: string; title: string; url: string }[];
  colors: TokenEntry[];
  typography: DesignSystemTypography;
}

export interface CompanyDefaultChange {
  designSystemId: string;
  organizationId: string;
}
