import { Palette } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DesignProject } from '../../api/types';
import { useDesignSystemQuery } from '../../api/queries';
import { useDesignLocalize } from '../../i18n';
import { designSystemPath } from '../../paths';

export default function DesignSystemControl({ project }: { project: DesignProject }) {
  const systemId = project.designSystemId;
  const localize = useDesignLocalize();
  const { data } = useDesignSystemQuery(systemId);
  const name = data?.name ?? systemId;
  return (
    <Link
      to={designSystemPath(systemId)}
      aria-label={localize('workspace.header.design_system', { name })}
      title={localize('workspace.header.design_system', { name })}
      className="hidden min-w-0 max-w-[12rem] items-center gap-1.5 rounded-full border border-border-light px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary sm:flex"
    >
      <Palette className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </Link>
  );
}
