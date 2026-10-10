import type { ExportDevice, ExportRequest } from '../../api/actions';
import type { DesignTranslationKey } from '../../i18n';
import type { DeviceId } from '../../state/atoms';

export type ExportOptionId =
  | 'html'
  | 'zip'
  | 'md'
  | 'pdf'
  | 'pdf_image'
  | 'pptx_image'
  | 'pptx_editable'
  | 'png';

export interface ExportOption {
  id: ExportOptionId;
  labelKey: DesignTranslationKey;
  descriptionKey: DesignTranslationKey;
  request: ExportRequest;
  disabledReasonKey: DesignTranslationKey | null;
  beta?: boolean;
}

export const EXPORT_PPTX_PERMISSION = 'exports.pptx';

export const EXPORT_DEVICE_KEYS: Record<ExportDevice, DesignTranslationKey> = {
  mobile: 'actions.device_mobile',
  tablet: 'actions.device_tablet',
  desktop: 'actions.device_desktop',
};

type FileKind = 'html' | 'markdown' | 'other' | 'none';

export function fileKindOf(path: string | null | undefined): FileKind {
  if (!path) {
    return 'none';
  }
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'html';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  return 'other';
}

export function exportDeviceOf(device: DeviceId | null | undefined): ExportDevice {
  return device === 'mobile' || device === 'tablet' ? device : 'desktop';
}

function markdownReason(kind: FileKind): DesignTranslationKey | null {
  if (kind === 'html' || kind === 'markdown') {
    return null;
  }
  return kind === 'none' ? 'actions.export_reason_open_html' : 'actions.export_reason_md_only';
}

function htmlReason(kind: FileKind): DesignTranslationKey | null {
  if (kind === 'html') {
    return null;
  }
  return kind === 'none' ? 'actions.export_reason_open_html' : 'actions.export_reason_html_only';
}

export function exportOptionsFor({
  permissions,
  path,
  device,
}: {
  permissions: readonly string[];
  path: string | null | undefined;
  device: DeviceId | null | undefined;
}): ExportOption[] {
  const kind = fileKindOf(path);
  const filePath = path ?? undefined;
  const html = htmlReason(kind);
  const markdown = markdownReason(kind);
  const pptx = permissions.includes(EXPORT_PPTX_PERMISSION)
    ? html
    : 'actions.export_reason_pptx_permission';
  const pngDevice = exportDeviceOf(device);

  return [
    {
      id: 'pdf',
      labelKey: 'actions.export_pdf',
      descriptionKey: 'actions.export_pdf_hint',
      request: { format: 'pdf', path: filePath, options: { pdfMode: 'vector' } },
      disabledReasonKey: html,
    },
    {
      id: 'pdf_image',
      labelKey: 'actions.export_pdf_image',
      descriptionKey: 'actions.export_pdf_image_hint',
      request: { format: 'pdf', path: filePath, options: { pdfMode: 'raster' } },
      disabledReasonKey: html,
    },
    {
      id: 'png',
      labelKey: 'actions.export_png',
      descriptionKey: EXPORT_DEVICE_KEYS[pngDevice],
      request: { format: 'png', path: filePath, options: { device: pngDevice } },
      disabledReasonKey: html,
    },
    {
      id: 'html',
      labelKey: 'actions.export_html',
      descriptionKey: 'actions.export_html_hint',
      request: { format: 'html', path: filePath },
      disabledReasonKey: html,
    },
    {
      id: 'zip',
      labelKey: 'actions.export_zip',
      descriptionKey: 'actions.export_zip_hint',
      request: { format: 'zip' },
      disabledReasonKey: null,
    },
    {
      id: 'md',
      labelKey: 'actions.export_md',
      descriptionKey: 'actions.export_md_hint',
      request: { format: 'md', path: filePath },
      disabledReasonKey: markdown,
    },
    {
      id: 'pptx_image',
      labelKey: 'actions.export_pptx_image',
      descriptionKey: 'actions.export_pptx_image_hint',
      request: { format: 'pptx', path: filePath, options: { pptxMode: 'image' } },
      disabledReasonKey: pptx,
    },
    {
      id: 'pptx_editable',
      labelKey: 'actions.export_pptx_editable',
      descriptionKey: 'actions.export_pptx_editable_hint',
      request: { format: 'pptx', path: filePath, options: { pptxMode: 'editable' } },
      disabledReasonKey: pptx,
      beta: true,
    },
  ];
}

export function safeDownloadUrl(url: string | null | undefined, base: string) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url, base);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
