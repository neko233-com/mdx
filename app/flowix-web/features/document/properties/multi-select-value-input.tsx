/**
 * Array-value input shared by MultiSelect, Tag, and Note Tags rows.
 * With options it renders a preset-bound multi-select menu; without options
 * it renders free-form chips. The row's semantic type remains owned by the
 * property model, not by this reusable input component.
 */

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useI18n, translate } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useComposingValue } from '@shared/hooks/use-composing-value';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@shared/ui/dropdown-menu';

interface MultiSelectValueInputProps {
  value: string;
  options?: readonly string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}

function tagsFromValue(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function MultiSelectValueInput({
  value,
  options = [],
  disabled = false,
  onChange,
}: MultiSelectValueInputProps) {
  const { t, language } = useI18n();
  const tags = tagsFromValue(value);
  const [draft, setDraft] = useState('');
  const draftInput = useComposingValue(draft, setDraft);

  const commitDraft = () => {
    const nextTag = draft.trim();
    if (!nextTag) return;
    if (!tags.includes(nextTag)) {
      onChange([...tags, nextTag].join(', '));
    }
    setDraft('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag).join(', '));
  };

  const toggleOption = (option: string) => {
    const next = tags.includes(option)
      ? tags.filter((item) => item !== option)
      : [...tags, option];
    onChange(next.join(', '));
  };

  if (options.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2 text-left text-sm',
              'hover:bg-[var(--muted)]/40 focus-visible:border-[var(--primary)] focus-visible:outline-none',
              disabled && 'pointer-events-none opacity-50',
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {tags.length > 0 ? tags.join(', ') : t('document.properties.select.placeholder')}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[200px] rounded-xl border-[var(--border-popup)] p-1 shadow-[0_4px_24px_-3px_rgb(0_0_0_/_0.24)]"
        >
          {options.map((option) => {
            const selected = tags.includes(option);
            return (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleOption(option)}
                className={cn(
                  'flex h-7 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm',
                  'hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] focus-visible:outline-none',
                )}
              >
                <span className="min-w-0 truncate">{option}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden="true" />}
              </button>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-2 py-1 text-sm focus-within:border-[var(--primary)]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-5 items-center gap-1 rounded-md bg-[var(--muted)] px-1.5 text-xs text-[var(--foreground)]"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label={translate(language, 'document.properties.deleteTag', { tag })}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        value={draftInput.value}
        disabled={disabled}
        placeholder={tags.length === 0 ? t('document.properties.tagInputPlaceholder') : ''}
        onChange={draftInput.onChange}
        onCompositionStart={draftInput.onCompositionStart}
        onCompositionEnd={draftInput.onCompositionEnd}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (draftInput.isComposingKeyboardEvent(event.nativeEvent)) return;
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === 'Backspace' && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1).join(', '));
          }
        }}
        className="min-w-[88px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
