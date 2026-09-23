import { Node, type Editor, type JSONContent, type MarkdownToken } from "@tiptap/core";

export interface ComposerFolderTokenValue {
  path: string;
  displayName?: string;
}

const FOLDER_HREF_PREFIX = "mdx://folder/";
const FOLDER_TOKEN_RE = /^\[([^\]\n]*)\]\((?:mdx|flowix):\/\/folder\/([^\s)]+)\)/i;
const FOLDER_TOKEN_GLOBAL_RE = /\[([^\]\n]*)\]\((?:mdx|flowix):\/\/folder\/([^\s)]+)\)/gi;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function folderDisplayName(path: string, displayName?: string | null): string {
  const explicit = displayName?.trim();
  if (explicit) return explicit;
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized || path;
}

export const ComposerFolderToken = Node.create({
  name: "composerFolderToken",
  priority: 1000,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      path: { default: "" },
      displayName: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-composer-folder]", getAttrs: (dom) => ({
      path: (dom as HTMLElement).getAttribute("data-composer-folder") ?? "",
      displayName: (dom as HTMLElement).getAttribute("data-composer-folder-display-name") || null,
    }) }];
  },

  renderHTML({ node }) {
    const path = String(node.attrs?.path ?? "");
    const displayName = folderDisplayName(
      path,
      typeof node.attrs?.displayName === "string" ? node.attrs.displayName : undefined,
    );
    return ["span", {
      "data-composer-folder": path,
      "data-composer-folder-display-name": displayName,
      class: "agent-thread-card__folder-token",
    }, `@${displayName}`];
  },

  markdownTokenizer: {
    name: "composerFolderToken",
    level: "inline" as const,
    start(src: string) {
      const index = src.search(/\((?:mdx|flowix):\/\/folder\//i);
      return index >= 0 ? Math.max(0, src.lastIndexOf("[", index)) : -1;
    },
    tokenize(src: string) {
      const match = FOLDER_TOKEN_RE.exec(src);
      return match ? {
        type: "composerFolderToken",
        raw: match[0],
        text: match[1],
        href: `${FOLDER_HREF_PREFIX}${match[2]}`,
      } : undefined;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const href = String(token.href ?? "");
    const encodedPath = href.slice(FOLDER_HREF_PREFIX.length);
    return {
      type: "composerFolderToken",
      attrs: {
        path: safeDecode(encodedPath),
        displayName: String(token.text ?? "").replace(/^@/, "").trim() || null,
      },
    };
  },

  renderMarkdown(node: JSONContent) {
    const path = String(node.attrs?.path ?? "").trim();
    if (!path) return "";
    const displayName = folderDisplayName(
      path,
      typeof node.attrs?.displayName === "string" ? node.attrs.displayName : undefined,
    );
    return `[${escapeMarkdownLinkText(`@${displayName}`)}](${FOLDER_HREF_PREFIX}${encodeURIComponent(path)})`;
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      const path = String(node.attrs.path ?? "");
      const displayName = folderDisplayName(
        path,
        typeof node.attrs.displayName === "string" ? node.attrs.displayName : undefined,
      );
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agent-thread-card__folder-token";
      button.textContent = `@${displayName}`;
      button.title = path;
      button.setAttribute("aria-label", `移除资料库 ${displayName}`);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined) return;
        view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
        view.focus();
      });
      return { dom: button };
    };
  },
});

export function insertComposerFolderToken(
  editor: Editor,
  path: string,
  displayName?: string,
  range?: { from: number; to: number },
): void {
  const { selection } = editor.state;
  const target = range ?? { from: selection.from, to: selection.to };
  editor.chain()
    .focus()
    .insertContentAt({ from: target.from, to: target.to }, [
      { type: "composerFolderToken", attrs: { path, displayName: displayName || null } },
      { type: "text", text: " " },
    ])
    .run();
}

/** Convert persisted folder cards to the compact mention syntax sent to the agent. */
export function composerFolderMarkdownToPrompt(markdown: string): string {
  return markdown.replace(
    FOLDER_TOKEN_GLOBAL_RE,
    (_match, displayName: string, encodedPath: string) => {
      const path = safeDecode(encodedPath);
      const label = folderDisplayName(path, displayName.replace(/^@/, ""));
      return `@${label}`;
    },
  );
}
