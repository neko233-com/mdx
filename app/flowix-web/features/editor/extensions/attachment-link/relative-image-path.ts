// Markdown stores local image locations relative to the document. The editor
// resolves them only while rendering, leaving the file portable on disk.
function splitAbsolutePath(value: string): { root: string; parts: string[] } | null {
    const path = value.replace(/\\/g, '/');
    const drive = /^[A-Za-z]:\//.exec(path);
    const root = drive ? drive[0].slice(0, 2).toUpperCase() : path.startsWith('/') ? '/' : null;
    if (!root) return null;
    const rest = drive ? path.slice(3) : path.slice(1);
    const parts: string[] = [];
    for (const part of rest.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) return null;
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return { root, parts };
}

function joinAbsolutePath(root: string, parts: string[]): string {
    return `${root === '/' ? '/' : `${root}/`}${parts.join('/')}`;
}

export function relativeImageHref(storageKey: string, documentPath?: string): string | null {
    if (!documentPath) return null;
    const image = splitAbsolutePath(storageKey);
    const document = splitAbsolutePath(documentPath);
    if (!image || !document || image.root !== document.root || !image.parts.length) return null;
    const folder = document.parts.slice(0, -1);
    let shared = 0;
    while (shared < folder.length && shared < image.parts.length &&
        (image.root === '/' ? folder[shared] === image.parts[shared] : folder[shared].toLowerCase() === image.parts[shared].toLowerCase())) {
        shared += 1;
    }
    const parts = [...Array(folder.length - shared).fill('..'), ...image.parts.slice(shared)];
    return parts.map(part => part === '..' ? part : encodeURIComponent(part)
        .replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
}

export function resolveRelativeImageHref(href: string, documentPath?: string): string | null {
    if (!documentPath || !href || href.startsWith('/') || href.startsWith('\\') ||
        /[?#]/.test(href) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(href)) return null;
    const document = splitAbsolutePath(documentPath);
    if (!document) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(href);
    } catch {
        return null;
    }
    if (decoded.startsWith('/') || decoded.startsWith('\\')) return null;
    const parts = document.parts.slice(0, -1);
    for (const part of decoded.replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) return null;
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    return parts.length ? joinAbsolutePath(document.root, parts) : null;
}
