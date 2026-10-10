import {
  OGDialog,
  OGDialogTitle,
  OGDialogFooter,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { ReactNode } from 'react';

export default function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  error,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  error?: string | null;
  footer: ReactNode;
}) {
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-md border-none bg-surface-dialog text-text-primary">
        <OGDialogHeader>
          <OGDialogTitle>{title}</OGDialogTitle>
          <OGDialogDescription className="text-sm text-text-secondary">
            {description}
          </OGDialogDescription>
        </OGDialogHeader>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-status-error-border bg-status-error-subtle px-3 py-2 text-sm text-text-primary"
          >
            {error}
          </p>
        ) : null}
        <OGDialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {footer}
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
}
