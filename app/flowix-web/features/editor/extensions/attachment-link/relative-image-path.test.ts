import { describe, expect, it } from 'vitest';
import { relativeImageHref, resolveRelativeImageHref } from './relative-image-path';

describe('document-relative image links', () => {
    it('stores notebook attachments relative to nested Windows notes', () => {
        const document = 'C:\\Notes\\drafts\\post.md';
        const image = 'C:\\Notes\\attachments\\figure (1).png';
        const href = relativeImageHref(image, document);
        expect(href).toBe('../attachments/figure%20%281%29.png');
        expect(resolveRelativeImageHref(href!, document)).toBe('C:/Notes/attachments/figure (1).png');
    });

    it('keeps a moved notebook portable on macOS', () => {
        const href = relativeImageHref('/old/Notes/attachments/photo.png', '/old/Notes/entry.md');
        expect(href).toBe('attachments/photo.png');
        expect(resolveRelativeImageHref(href!, '/new/Notes/entry.md')).toBe('/new/Notes/attachments/photo.png');
    });

    it('leaves remote URLs and malformed paths alone', () => {
        expect(resolveRelativeImageHref('https://images.example/photo.png', '/notes/post.md')).toBeNull();
        expect(resolveRelativeImageHref('../../outside.png', '/notes/post.md')).toBeNull();
        expect(relativeImageHref('D:/images/photo.png', 'C:/notes/post.md')).toBeNull();
        expect(resolveRelativeImageHref('bad%path.png', '/notes/post.md')).toBeNull();
    });
});
