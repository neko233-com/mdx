import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export interface TagIconProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'prefix'> {
  /** Add the standard visual gap before a tag name. */
  prefix?: boolean;
}

/**
 * The shared visual representation of a tag's `#`.
 *
 * The text character is intentional: the custom font replaces only `#`, so
 * accessibility, selection/search labels, and serialized tag names remain
 * ordinary text while the rendered mark uses the Flowix tag glyph.
 */
export function TagIcon({ className, prefix = false, ...props }: TagIconProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn('flowix-tag-icon', prefix && 'flowix-tag-icon--prefix', className)}
    >
      #
    </span>
  );
}
