export const FLOWIX_MEDIA_STYLE_VERSION = 1;

export interface FlowixMediaStyleSuffix {
  raw: string;
  style: Record<string, unknown>;
}

const FLOWIX_MEDIA_STYLE_COMMENT_RE = /^<!--[ \t]*flowix:media[ \t]+(\{[^\r\n]*\})[ \t]*-->(?:\r?\n)+/;

function readJsonObject(source: string): { raw: string; value: unknown } | null {
  if (!source.startsWith('{')) return null;

  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth !== 0) continue;

      const raw = source.slice(0, index + 1);
      try {
        return { raw, value: JSON.parse(raw) };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function parseFlowixMediaStyleSuffix(source: string): FlowixMediaStyleSuffix | null {
  const parsed = readJsonObject(source);
  if (!parsed || !parsed.value || typeof parsed.value !== 'object') return null;

  const metadata = parsed.value as {
    flowix?: unknown;
    version?: unknown;
    style?: unknown;
  };
  if (
    metadata.flowix !== 'media' ||
    metadata.version !== FLOWIX_MEDIA_STYLE_VERSION ||
    !metadata.style ||
    typeof metadata.style !== 'object' ||
    Array.isArray(metadata.style)
  ) {
    return null;
  }

  return {
    raw: parsed.raw,
    style: metadata.style as Record<string, unknown>,
  };
}

export function parseFlowixMediaStyleComment(source: string): FlowixMediaStyleSuffix | null {
  const match = FLOWIX_MEDIA_STYLE_COMMENT_RE.exec(source);
  if (!match) return null;

  const parsed = parseFlowixMediaStyleSuffix(match[1]);
  return parsed ? { raw: match[0], style: parsed.style } : null;
}

export function renderFlowixMediaStyleComment(style: Record<string, unknown>): string {
  if (Object.keys(style).length === 0) return '';

  const metadata = JSON.stringify({
    flowix: 'media',
    version: FLOWIX_MEDIA_STYLE_VERSION,
    style,
  });
  return `<!-- flowix:media ${metadata} -->\n`;
}
