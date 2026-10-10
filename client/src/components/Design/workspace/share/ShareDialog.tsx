import { useId, useState } from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Skeleton,
  Spinner,
  Switch,
  useToastContext,
} from '@librechat/client';
import type { DesignProject, DesignShare } from '../../api/types';
import { PUBLIC_LINK_DAYS, PUBLIC_LINK_DEFAULT_DAYS, sharePermissionsOf } from './share-rules';
import { useCreateShareMutation, useRevokeSharesMutation } from '../../api/action-queries';
import { useDesignMeQuery, useDesignSharesQuery } from '../../api/queries';
import { designErrorCode, isDesignApiError } from '../../api/errors';
import { useDesignLocalize, type DesignLocalize } from '../../i18n';
import ConfirmActionDialog from '../actions/ConfirmActionDialog';
import { DesignErrorState } from '../../common/DesignStates';
import { actionErrorMessageKey } from '../actions/errors';
import CopyField from '../actions/CopyField';

function formatDate(value: string | null) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function linkErrorText(localize: DesignLocalize, error: unknown) {
  const maxDays = isDesignApiError(error) ? error.details?.maxDays : undefined;
  if (designErrorCode(error) === 'share_expiry_too_long' && typeof maxDays === 'number') {
    return localize('actions.error_share_expiry_max', { maxDays });
  }
  return localize(actionErrorMessageKey(error, 'actions.share_error'));
}

function Section({
  title,
  titleId,
  children,
}: {
  title: string;
  titleId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-border-light p-4"
    >
      <h3 id={titleId} className="text-sm font-semibold text-text-primary">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ShareRow({
  label,
  detail,
  onRevoke,
  disabled,
}: {
  label: string;
  detail?: string;
  onRevoke: () => void;
  disabled: boolean;
}) {
  const localize = useDesignLocalize();
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg bg-surface-secondary px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm text-text-primary">{label}</span>
        {detail ? <span className="block text-xs text-text-secondary">{detail}</span> : null}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRevoke}
        disabled={disabled}
        aria-label={localize('actions.share_revoke_named', { name: label })}
      >
        {localize('actions.share_revoke')}
      </Button>
    </li>
  );
}

function ShareBody({ project }: { project: DesignProject }) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const companyTitleId = useId();
  const publicTitleId = useId();
  const peopleTitleId = useId();
  const expiryId = useId();
  const { data: me } = useDesignMeQuery();
  const rules = sharePermissionsOf(project, me);
  const shares = useDesignSharesQuery(project.projectId, { enabled: rules.canManage });
  const createShare = useCreateShareMutation(project.projectId);
  const revokeShares = useRevokeSharesMutation(project.projectId);
  const [days, setDays] = useState(PUBLIC_LINK_DEFAULT_DAYS);
  const [createdLink, setCreatedLink] = useState<DesignShare | null>(null);
  const [linkError, setLinkError] = useState<unknown>(null);
  const [revoking, setRevoking] = useState<DesignShare | null>(null);

  if (!rules.canManage) {
    return (
      <p className="rounded-xl bg-surface-secondary p-4 text-sm text-text-secondary">
        {localize(rules.reasonKey ?? 'actions.share_reason_read_only')}
      </p>
    );
  }
  if (shares.isLoading) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">{localize('loading')}</span>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (shares.error) {
    return (
      <DesignErrorState
        message={localize(actionErrorMessageKey(shares.error, 'actions.share_error'))}
        onRetry={() => {
          shares.refetch();
        }}
      />
    );
  }

  const active = shares.data ?? [];
  const companyShares = active.filter((share) => share.kind === 'company');
  const publicShares = active.filter((share) => share.kind === 'public');
  const peopleShares = active.filter((share) => share.kind === 'people');
  const pending = createShare.isLoading || revokeShares.isLoading;

  const notifyError = (error: unknown, fallback: Parameters<typeof actionErrorMessageKey>[1]) =>
    showToast({ status: 'error', message: localize(actionErrorMessageKey(error, fallback)) });

  const toggleCompany = (checked: boolean) => {
    if (checked) {
      createShare.mutate(
        { kind: 'company' },
        { onError: (error) => notifyError(error, 'actions.share_error') },
      );
      return;
    }
    revokeShares.mutate(
      companyShares.map((share) => share.shareId),
      { onError: (error) => notifyError(error, 'actions.share_error') },
    );
  };

  const createLink = () => {
    setLinkError(null);
    setCreatedLink(null);
    createShare.mutate(
      { kind: 'public', expiresInDays: days },
      {
        onSuccess: (share) => setCreatedLink(share),
        onError: (error) => setLinkError(error),
      },
    );
  };

  const confirmRevoke = () => {
    if (!revoking) {
      return;
    }
    const target = revoking;
    revokeShares.mutate([target.shareId], {
      onSuccess: () => {
        setRevoking(null);
        if (createdLink?.shareId === target.shareId) {
          setCreatedLink(null);
        }
        showToast({ status: 'success', message: localize('actions.share_revoked') });
      },
      onError: (error) => {
        setRevoking(null);
        notifyError(error, 'actions.share_error');
      },
    });
  };

  const linkErrorMessage = linkError ? linkErrorText(localize, linkError) : null;

  return (
    <div className="flex flex-col gap-4">
      <Section title={localize('actions.share_company_title')} titleId={companyTitleId}>
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-text-secondary">
            {rules.canShareCompany
              ? localize('actions.share_company_hint')
              : localize('actions.share_reason_company_permission')}
          </p>
          <Switch
            aria-labelledby={companyTitleId}
            checked={companyShares.length > 0}
            disabled={!rules.canShareCompany || pending}
            onCheckedChange={toggleCompany}
          />
        </div>
      </Section>

      <Section title={localize('actions.share_public_title')} titleId={publicTitleId}>
        {rules.canSharePublic ? (
          <>
            <p className="text-sm text-text-secondary">{localize('actions.share_public_hint')}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={expiryId} className="text-xs font-medium text-text-secondary">
                  {localize('actions.share_public_expiry')}
                </label>
                <select
                  id={expiryId}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                  className="h-9 rounded-lg border border-border-light bg-surface-secondary px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                >
                  {PUBLIC_LINK_DAYS.map((value) => (
                    <option key={value} value={value}>
                      {localize('actions.share_public_days', { count: value })}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" size="sm" onClick={createLink} disabled={pending}>
                {createShare.isLoading ? <Spinner className="size-4" /> : null}
                <Link2 className="size-4" aria-hidden="true" />
                {localize('actions.share_public_create')}
              </Button>
            </div>
            {linkErrorMessage ? (
              <p role="alert" className="text-sm text-text-primary">
                {linkErrorMessage}
              </p>
            ) : null}
            {createdLink?.url ? (
              <div className="flex flex-col gap-2 rounded-lg bg-surface-secondary p-3">
                <CopyField label={localize('actions.share_public_link')} value={createdLink.url} />
                <p role="note" className="flex items-start gap-2 text-xs text-text-primary">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {localize('actions.share_public_once')}
                </p>
              </div>
            ) : null}
            {publicShares.length > 0 ? (
              <ul
                aria-label={localize('actions.share_public_active')}
                className="flex flex-col gap-2"
              >
                {publicShares.map((share) => (
                  <ShareRow
                    key={share.shareId}
                    label={localize('actions.share_public_row')}
                    detail={
                      share.expiresAt
                        ? localize('actions.share_expires_at', {
                            date: formatDate(share.expiresAt),
                          })
                        : undefined
                    }
                    disabled={pending}
                    onRevoke={() => setRevoking(share)}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-text-secondary">
            {localize('actions.share_reason_public_permission')}
          </p>
        )}
      </Section>

      <Section title={localize('actions.share_people_title')} titleId={peopleTitleId}>
        <p className="text-sm text-text-secondary">{localize('actions.share_people_hint')}</p>
        {peopleShares.length > 0 ? (
          <ul aria-label={localize('actions.share_people_active')} className="flex flex-col gap-2">
            {peopleShares.map((share) => (
              <ShareRow
                key={share.shareId}
                label={localize('actions.share_people_row', { count: share.authUserIds.length })}
                detail={
                  share.expiresAt
                    ? localize('actions.share_expires_at', { date: formatDate(share.expiresAt) })
                    : undefined
                }
                disabled={pending}
                onRevoke={() => setRevoking(share)}
              />
            ))}
          </ul>
        ) : null}
      </Section>

      <ConfirmActionDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
          }
        }}
        title={localize('actions.share_revoke_title')}
        description={localize(
          revoking?.kind === 'public'
            ? 'actions.share_revoke_public_description'
            : 'actions.share_revoke_people_description',
        )}
        confirmLabel={localize('actions.share_revoke')}
        onConfirm={confirmRevoke}
        isLoading={revokeShares.isLoading}
        destructive
      />
    </div>
  );
}

export default function ShareDialog({
  project,
  open,
  onOpenChange,
}: {
  project: DesignProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-lg flex-col overflow-hidden">
        <OGDialogHeader>
          <OGDialogTitle>{localize('actions.share_title')}</OGDialogTitle>
          <OGDialogDescription className="truncate">{project.name}</OGDialogDescription>
        </OGDialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShareBody project={project} />
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
