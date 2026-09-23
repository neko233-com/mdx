import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ImageAttachment } from '@features/editor/extensions/attachment-link/nodes/view-image';
import { buildUploadContent, insertUploadContent } from './build-content';

describe('insertUploadContent', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('records an asynchronously completed image paste as one undoable history event', () => {
    editor = new Editor({
      extensions: [StarterKit, ImageAttachment],
      content: 'Before',
    });

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const before = editor.getJSON();
    insertUploadContent(editor.view, [{
      type: 'image',
      attrs: {
        src: 'https://example.com/pasted.png',
        alt: 'pasted.png',
        title: 'pasted.png',
        storageMode: null,
        storageKey: null,
      },
    }]);

    expect(editor.getJSON()).not.toEqual(before);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe('buildUploadContent', () => {
  it('keeps the PicGo URL as the image source without inventing a local storage path', () => {
    expect(buildUploadContent([{
      kind: 'image',
      url: 'https://images.example/note.png',
      name: 'note.png',
      fileName: 'note.png',
      mimeType: 'image/png',
      size: 0,
      storageKey: null,
    }])).toEqual([{
      type: 'image',
      attrs: {
        src: 'https://images.example/note.png',
        alt: 'note.png',
        title: 'note.png',
        fileName: 'note.png',
        mimeType: 'image/png',
        storageMode: null,
        storageKey: null,
      },
    }]);
  });
});
