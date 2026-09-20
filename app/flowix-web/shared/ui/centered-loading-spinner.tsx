import { useI18n } from '@/lib/i18n';

interface CenteredLoadingSpinnerProps {
  className?: string;
  ariaLabel?: string;
}

export function CenteredLoadingSpinner({
  className = '',
  ariaLabel,
}: CenteredLoadingSpinnerProps) {
  const { t } = useI18n();
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-label={ariaLabel ?? t('memo.navigation.loading')}
    >
      <div
        className="h-5 w-5 animate-spin rounded-full border-2 border-[color-mix(in_oklch,var(--muted-foreground)_26%,transparent)] border-t-[var(--brand)]"
        aria-hidden="true"
      />
    </div>
  );
}
