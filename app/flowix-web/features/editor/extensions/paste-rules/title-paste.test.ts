import { describe, expect, it } from 'vitest';
import type { ClipboardSnapshot } from './clipboard';
import { splitClipboardForTitlePaste } from './title-paste';

function snapshot(overrides: Partial<ClipboardSnapshot>): ClipboardSnapshot {
  return {
    types: ['text/plain', 'text/html'],
    text: '',
    html: '',
    files: [],
    ...overrides,
  };
}

describe('splitClipboardForTitlePaste', () => {
  it('keeps rich formatting on the body side of an HTML paste', () => {
    const result = splitClipboardForTitlePaste(snapshot({
      text: 'Title\nBody',
      html: '<p><strong>Title</strong></p><p><em>Body</em></p>',
    }));

    expect(result?.titleLine).toBe('Title');
    expect(result?.body.text).toBe('Body');
    expect(result?.body.html).toContain('<em>Body</em>');
    expect(result?.body.html).not.toContain('Title');
  });

  it('does not split a paste that starts with an empty line', () => {
    expect(splitClipboardForTitlePaste(snapshot({
      text: '\nBody',
    }))).toBeNull();
  });
});
