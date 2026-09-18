/**
 * Single-select value input for `Select` property rows. Reads its option
 * list from the row's preset; falls back to a fixed empty list for free-key
 * rows.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface SelectValueInputProps {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}

export function SelectValueInput({
  value,
  options,
  disabled = false,
  onChange,
}: SelectValueInputProps) {
  const { t } = useI18n();
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          'h-8 rounded-lg',
          disabled && 'pointer-events-none opacity-50'
        )}
      >
        <SelectValue placeholder={t('document.properties.select.placeholder')} />
      </SelectTrigger>
      <SelectContent
        align="start"
        className="min-w-[160px] rounded-xl border-[var(--border-popup)] p-1 shadow-[0_4px_24px_-3px_rgb(0_0_0_/_0.24)]"
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
            {t('document.properties.select.empty')}
          </div>
        ) : (
          options.map((option) => (
            <SelectItem
              key={option}
              value={option}
              className="h-7 !min-h-7 rounded-lg px-2 py-0 text-left hover:bg-[var(--hover-bg)]"
            >
              {option}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
