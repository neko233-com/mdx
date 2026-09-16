import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AlertCircle,
  Brain,
  Bot,
  Check,
  FileCode2,
  Globe2,
  Loader2,
  Pencil,
  Plus,
  Save,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { agent, type NotebookAgentFile, type NotebookAgentWorkspace, type NotebookMcpDefinition } from "@platform/tauri/client/agent";
import { Button } from "@shared/ui/button";
import { cn } from "@/lib/utils";

type Tab = "mcp" | "skills" | "agents" | "memory";
type FileKind = "skill" | "agent";
type EditorState =
  | { kind: "mcp"; id: string | null }
  | { kind: "file"; fileKind: FileKind; id: string | null };

const EMPTY_WORKSPACE: NotebookAgentWorkspace = {
  version: 1,
  rootPath: "",
  mcpServers: {},
  skills: [],
  agents: [],
};

const inputClass =
  "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_oklch,var(--primary)_16%,transparent)]";
const textareaClass =
  "min-h-32 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-6 text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_oklch,var(--primary)_16%,transparent)]";

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneWorkspace(workspace: NotebookAgentWorkspace): NotebookAgentWorkspace {
  return {
    ...workspace,
    mcpServers: Object.fromEntries(
      Object.entries(workspace.mcpServers ?? {}).map(([id, definition]) => [id, { ...definition }]),
    ),
    skills: (workspace.skills ?? []).map((item) => ({ ...item, frontmatter: { ...(item.frontmatter ?? {}) } })),
    agents: (workspace.agents ?? []).map((item) => ({ ...item, frontmatter: { ...(item.frontmatter ?? {}) } })),
  };
}

function pathFor(kind: FileKind, id: string): string {
  return `.agents/${kind === "skill" ? "skills" : "agents"}/${id}/${kind}.md`;
}

function displayMcpTransport(definition: NotebookMcpDefinition): string {
  return definition.url || definition.transport === "streamable-http" || definition.transport === "http"
    ? "远程 URL"
    : "本地命令";
}

function mcpFormFrom(id: string, definition: NotebookMcpDefinition) {
  const remote = displayMcpTransport(definition) === "远程 URL";
  return {
    id,
    description: typeof definition.description === "string" ? definition.description : "",
    transport: remote ? "streamable-http" : "stdio",
    command: typeof definition.command === "string" ? definition.command : "",
    args: Array.isArray(definition.args) ? definition.args.filter((item): item is string => typeof item === "string").join("\n") : "",
    url: typeof definition.url === "string" ? definition.url : "",
    enabled: definition.enabled !== false,
  };
}

function emptyFile(kind: FileKind): NotebookAgentFile {
  return {
    id: newId(kind),
    name: "",
    description: "",
    enabled: true,
    body: "",
    path: "",
    frontmatter: {},
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-3 text-xs font-medium text-[var(--foreground)]">
        <span>{label}</span>
        {hint && <span className="font-normal text-[var(--muted-foreground)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--muted-foreground)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label || "启用配置"}
        className="peer sr-only"
      />
      <span className="relative h-5 w-9 rounded-full bg-[var(--muted)] transition-colors peer-checked:bg-[var(--primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[color-mix(in_oklch,var(--primary)_28%,transparent)] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Server; title: string; description: string; action: React.ReactNode }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] text-[var(--primary)]">
        <Icon className="h-5 w-5" strokeWidth={1.7} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="mt-1 max-w-[38ch] text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function SectionHeader({ title, description, action }: { title: string; description: string; action: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-[var(--foreground)]">{title}</h2>
        <p className="mt-1 max-w-[58ch] text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function TabButton({ active, icon: Icon, label, count, onClick }: { active: boolean; icon: typeof Server; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "group flex h-7 min-h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
        active ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums", active ? "bg-white/15 text-current" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{count}</span>}
    </button>
  );
}

function McpEditor({
  form,
  onChange,
  onCancel,
  onSave,
  error,
  saving,
}: {
  form: ReturnType<typeof mcpFormFrom>;
  onChange: (patch: Partial<ReturnType<typeof mcpFormFrom>>) => void;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
  saving: boolean;
}) {
  const isRemote = form.transport === "streamable-http";
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_82%,var(--background))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            {isRemote ? <Globe2 className="h-4 w-4 text-[var(--primary)]" /> : <Terminal className="h-4 w-4 text-[var(--primary)]" />}
            {form.id ? "编辑 MCP 服务" : "添加 MCP 服务"}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">只填写 Agent 连接所需的信息，配置会生成到笔记本的 `.agents/mcp.json`。</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭编辑" onClick={onCancel}><X /></Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="服务 ID" hint="文件中的名称">
          <input className={inputClass} value={form.id} onChange={(event) => onChange({ id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })} placeholder="例如 docs-search" />
        </Field>
        <Field label="显示说明" hint="可选">
          <input className={inputClass} value={form.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="例如 搜索项目文档" />
        </Field>
      </div>
      <Field label="连接方式">
        <div className="grid grid-cols-2 gap-2">
          {(["stdio", "streamable-http"] as const).map((transport) => (
            <button key={transport} type="button" onClick={() => onChange({ transport })} className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors", form.transport === transport ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_9%,var(--background))] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]")}>
              {transport === "stdio" ? <Terminal className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
              <span>{transport === "stdio" ? "本地命令" : "远程 URL"}</span>
              {form.transport === transport && <Check className="ml-auto h-4 w-4 text-[var(--primary)]" />}
            </button>
          ))}
        </div>
      </Field>
      {isRemote ? (
        <Field label="服务 URL">
          <input className={inputClass} value={form.url} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://example.com/mcp" inputMode="url" />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="启动命令">
            <input className={inputClass} value={form.command} onChange={(event) => onChange({ command: event.target.value })} placeholder="例如 npx" />
          </Field>
          <Field label="参数" hint="每行一个">
            <textarea className={cn(textareaClass, "min-h-[5.75rem] font-mono text-xs leading-5")} value={form.args} onChange={(event) => onChange({ args: event.target.value })} placeholder={'-y\n@mcp/server-filesystem'} />
          </Field>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--divider)] pt-4">
        <Toggle checked={form.enabled} onChange={(enabled) => onChange({ enabled })} label="启用此服务" />
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
          <Button type="button" disabled={saving} onClick={onSave}>{saving ? <Loader2 className="animate-spin" /> : <Save />}保存服务</Button>
        </div>
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}

function FileEditor({
  kind,
  form,
  onChange,
  onCancel,
  onSave,
  error,
}: {
  kind: FileKind;
  form: NotebookAgentFile;
  onChange: (patch: Partial<NotebookAgentFile>) => void;
  onCancel: () => void;
  onSave: () => void;
  error: string | null;
}) {
  const isSkill = kind === "skill";
  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_82%,var(--background))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            {isSkill ? <Sparkles className="h-4 w-4 text-[var(--primary)]" /> : <Bot className="h-4 w-4 text-[var(--primary)]" />}
            {isSkill ? "编辑 Skill" : "编辑子 Agent"}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">用自然语言描述它负责什么，以及它应该如何工作。</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭编辑" onClick={onCancel}><X /></Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="名称">
          <input className={inputClass} value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={isSkill ? "例如 代码审查" : "例如 代码审查员"} autoFocus />
        </Field>
        <Field label="ID" hint="用于文件夹名">
          <input className={cn(inputClass, "font-mono text-xs")} value={form.id} onChange={(event) => onChange({ id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder={isSkill ? "code-review" : "code-reviewer"} />
        </Field>
      </div>
      <Field label="一句话说明">
        <input className={inputClass} value={form.description} onChange={(event) => onChange({ description: event.target.value })} placeholder={isSkill ? "说明什么时候使用这个 Skill" : "说明这个 Agent 擅长处理什么"} />
      </Field>
      <Field label={isSkill ? "Skill 指令" : "Agent 工作指令"} hint="Markdown">
        <textarea className={cn(textareaClass, "min-h-44")} value={form.body} onChange={(event) => onChange({ body: event.target.value })} placeholder={isSkill ? "例如：\n\n1. 先检查代码变更。\n2. 标记安全风险和测试缺口。" : "例如：\n\n你是一名代码审查专家。\n请优先关注安全性、性能和测试覆盖率。"} />
      </Field>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--divider)] pt-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--muted-foreground)]"><FileCode2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate font-mono">{pathFor(kind, form.id || "<id>")}</span></div>
        <div className="flex items-center gap-2">
          <Toggle checked={form.enabled} onChange={(enabled) => onChange({ enabled })} label="启用" />
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
          <Button type="button" onClick={onSave}><Save />保存</Button>
        </div>
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <div className="mt-3 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklch,var(--destructive)_24%,var(--divider))] bg-[color-mix(in_oklch,var(--destructive)_6%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--destructive)]"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{message}</div>;
}

function EnabledStatus({ enabled }: { enabled: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
      <span className={cn("h-1.5 w-1.5 rounded-full", enabled ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]")} aria-hidden="true" />
      {enabled ? "已启用" : "已停用"}
    </span>
  );
}

function McpList({
  workspace,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: {
  workspace: NotebookAgentWorkspace;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const entries = Object.entries(workspace.mcpServers);
  if (!entries.length) {
    return <EmptyState icon={Server} title="还没有 MCP 服务" description="添加一个外部工具或数据源，让笔记本里的 Agent 可以按需使用。" action={<Button onClick={onAdd}><Plus />添加 MCP 服务</Button>} />;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_82%,var(--background))]">
      {entries.map(([id, definition]) => (
        <div key={id} className="group flex min-h-[68px] items-center gap-3 border-b border-[var(--divider)] px-4 py-3.5 last:border-b-0">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))] text-[var(--primary)]"><Server className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium text-[var(--foreground)]">{id}</span><EnabledStatus enabled={definition.enabled !== false} /></div>
            <div className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{typeof definition.description === "string" && definition.description ? definition.description : displayMcpTransport(definition)}</div>
          </div>
          <Toggle checked={definition.enabled !== false} onChange={(enabled) => onToggle(id, enabled)} label="" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑 ${id}`} onClick={() => onEdit(id)}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除 ${id}`} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]" onClick={() => onDelete(id)}><Trash2 /></Button>
        </div>
      ))}
    </div>
  );
}

function FileList({
  kind,
  items,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: {
  kind: FileKind;
  items: NotebookAgentFile[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const isSkill = kind === "skill";
  if (!items.length) {
    return <EmptyState icon={isSkill ? Sparkles : Bot} title={isSkill ? "还没有 Skills" : "还没有子 Agent"} description={isSkill ? "把重复的工作步骤保存下来，之后可以被不同 Agent 复用。" : "创建一个专门角色，让主 Agent 可以把任务交给它处理。"} action={<Button onClick={onAdd}><Plus />{isSkill ? "创建 Skill" : "创建子 Agent"}</Button>} />;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_82%,var(--background))]">
      {items.map((item) => (
        <div key={item.id} className="group flex min-h-[68px] items-center gap-3 border-b border-[var(--divider)] px-4 py-3.5 last:border-b-0">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isSkill ? "bg-[color-mix(in_oklch,var(--primary)_9%,var(--card))] text-[var(--primary)]" : "bg-[color-mix(in_oklch,var(--foreground)_8%,var(--card))] text-[var(--foreground)]")}>
            {isSkill ? <Sparkles className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium text-[var(--foreground)]">{item.name || item.id}</span><EnabledStatus enabled={item.enabled !== false} /></div>
            <div className="mt-1 truncate text-xs text-[var(--muted-foreground)]">{item.description || pathFor(kind, item.id)}</div>
          </div>
          <Toggle checked={item.enabled !== false} onChange={(enabled) => onToggle(item.id, enabled)} label="" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑 ${item.name || item.id}`} onClick={() => onEdit(item.id)}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除 ${item.name || item.id}`} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]" onClick={() => onDelete(item.id)}><Trash2 /></Button>
        </div>
      ))}
    </div>
  );
}

function NotebookAgentSettingsDialog({ notebookPath, onClose }: { notebookPath: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("mcp");
  const [workspace, setWorkspace] = useState<NotebookAgentWorkspace | null>(null);
  const [original, setOriginal] = useState<NotebookAgentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [mcpForm, setMcpForm] = useState<ReturnType<typeof mcpFormFrom> | null>(null);
  const [fileForm, setFileForm] = useState<NotebookAgentFile | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const dirty = workspace !== null && original !== null && JSON.stringify(workspace) !== JSON.stringify(original);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = cloneWorkspace(await agent.readNotebookAgentWorkspace(notebookPath));
      setWorkspace(next);
      setOriginal(cloneWorkspace(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [notebookPath]);

  useEffect(() => { void load(); }, [load]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm("还有未保存的 Agent 配置，确定要放弃吗？")) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  const openMcp = (id: string | null) => {
    if (!workspace) return;
    const definition = id ? workspace.mcpServers[id] ?? {} : {};
    setMcpForm(id ? mcpFormFrom(id, definition) : { id: newId("mcp"), description: "", transport: "stdio", command: "", args: "", url: "", enabled: true });
    setFormError(null);
    setEditor({ kind: "mcp", id });
  };

  const openFile = (kind: FileKind, id: string | null) => {
    if (!workspace) return;
    const source = (kind === "skill" ? workspace.skills : workspace.agents).find((item) => item.id === id);
    setFileForm(source ? { ...source, frontmatter: { ...(source.frontmatter ?? {}) } } : emptyFile(kind));
    setFormError(null);
    setEditor({ kind: "file", fileKind: kind, id });
  };

  const closeEditor = () => {
    setEditor(null);
    setMcpForm(null);
    setFileForm(null);
    setFormError(null);
  };

  const saveMcpDraft = () => {
    if (!workspace || !mcpForm) return;
    const id = mcpForm.id.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      setFormError("服务 ID 只能使用小写字母、数字、连字符和下划线。");
      return;
    }
    if (editor?.kind !== "mcp") return;
    if (id !== editor.id && workspace.mcpServers[id]) {
      setFormError("这个服务 ID 已经存在，请换一个。");
      return;
    }
    if (mcpForm.transport === "stdio" && !mcpForm.command.trim()) {
      setFormError("请输入本地启动命令。");
      return;
    }
    if (mcpForm.transport === "streamable-http" && !mcpForm.url.trim()) {
      setFormError("请输入服务 URL。");
      return;
    }
    const previous = editor.id ? workspace.mcpServers[editor.id] : undefined;
    const definition: NotebookMcpDefinition = { ...(previous ?? {}) };
    definition.transport = mcpForm.transport;
    definition.enabled = mcpForm.enabled;
    if (mcpForm.description.trim()) definition.description = mcpForm.description.trim();
    else delete definition.description;
    if (mcpForm.transport === "stdio") {
      definition.command = mcpForm.command.trim();
      definition.args = mcpForm.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      delete definition.url;
    } else {
      definition.url = mcpForm.url.trim();
      delete definition.command;
      delete definition.args;
    }
    const nextServers = { ...workspace.mcpServers };
    if (editor.id && editor.id !== id) delete nextServers[editor.id];
    nextServers[id] = definition;
    setWorkspace({ ...workspace, mcpServers: nextServers });
    closeEditor();
  };

  const saveFileDraft = () => {
    if (!workspace || !fileForm || editor?.kind !== "file") return;
    const id = fileForm.id.trim();
    const label = editor.fileKind === "skill" ? "Skill" : "子 Agent";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      setFormError(`${label} ID 只能使用小写字母、数字和连字符。`);
      return;
    }
    if (!fileForm.name.trim()) {
      setFormError(`请输入${label}名称。`);
      return;
    }
    if (!fileForm.body.trim()) {
      setFormError(`请输入${label}指令。`);
      return;
    }
    const collection = editor.fileKind === "skill" ? workspace.skills : workspace.agents;
    if (collection.some((item) => item.id === id && item.id !== editor.id)) {
      setFormError(`这个${label} ID 已经存在，请换一个。`);
      return;
    }
    const nextFile = { ...fileForm, id, name: fileForm.name.trim(), description: fileForm.description.trim(), body: fileForm.body.trim(), path: pathFor(editor.fileKind, id) };
    const nextCollection = editor.id
      ? collection.map((item) => (item.id === editor.id ? nextFile : item))
      : [...collection, nextFile];
    setWorkspace(editor.fileKind === "skill" ? { ...workspace, skills: nextCollection } : { ...workspace, agents: nextCollection });
    closeEditor();
  };

  const saveWorkspace = async () => {
    if (!workspace || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = cloneWorkspace(await agent.writeNotebookAgentWorkspace(notebookPath, workspace));
      setWorkspace(next);
      setOriginal(cloneWorkspace(next));
      closeEditor();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const deleteMcp = (id: string) => {
    if (!workspace || !window.confirm(`确定删除 MCP 服务“${id}”？`)) return;
    const next = { ...workspace.mcpServers };
    delete next[id];
    setWorkspace({ ...workspace, mcpServers: next });
  };

  const deleteFile = (kind: FileKind, id: string) => {
    if (!workspace || !window.confirm(`确定删除这个${kind === "skill" ? "Skill" : "子 Agent"}？`)) return;
    const collection = kind === "skill" ? workspace.skills : workspace.agents;
    const next = collection.filter((item) => item.id !== id);
    setWorkspace(kind === "skill" ? { ...workspace, skills: next } : { ...workspace, agents: next });
  };

  const toggleMcp = (id: string, enabled: boolean) => {
    if (!workspace || !workspace.mcpServers[id]) return;
    setWorkspace({ ...workspace, mcpServers: { ...workspace.mcpServers, [id]: { ...workspace.mcpServers[id], enabled } } });
  };

  const toggleFile = (kind: FileKind, id: string, enabled: boolean) => {
    if (!workspace) return;
    const collection = kind === "skill" ? workspace.skills : workspace.agents;
    const next = collection.map((item) => item.id === id ? { ...item, enabled } : item);
    setWorkspace(kind === "skill" ? { ...workspace, skills: next } : { ...workspace, agents: next });
  };

  const counts = useMemo(() => workspace ? [Object.keys(workspace.mcpServers).length, workspace.skills.length, workspace.agents.length] : [0, 0, 0], [workspace]);

  if (loading) {
    return <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/50 p-3"><div role="dialog" aria-modal="true" aria-label="项目 AI 设置" className="notebook-agent-settings-dialog flex h-[min(760px,calc(100vh-24px))] w-full max-w-[980px] items-center justify-center rounded-2xl bg-[var(--background)] shadow-2xl"><Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" /></div></div>;
  }

  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/50 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="项目 AI 设置" className="notebook-agent-settings-dialog relative flex h-[min(820px,calc(100vh-24px))] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl bg-[var(--background)] shadow-2xl">
        <header className="flex shrink-0 items-center gap-4 border-b border-[var(--divider)] px-5 py-3 sm:px-6">
          <h1 className="min-w-0 flex-1 truncate whitespace-nowrap text-base font-semibold tracking-[-0.02em] text-[var(--foreground)]">项目 AI 设置</h1>
          <div className="hidden items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] sm:flex"><span>{counts[0]} MCP</span><span>·</span><span>{counts[1]} Skills</span><span>·</span><span>{counts[2]} Agents</span></div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" onClick={requestClose}><X /></Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="flex shrink-0 border-b border-[var(--divider)] bg-[color-mix(in_oklch,var(--card)_45%,transparent)] p-2 md:w-48 md:flex-col md:border-b-0 md:border-r md:p-3" aria-label="项目 AI 设置导航">
            <div className="flex gap-1 md:flex-col md:gap-0 md:space-y-1" role="tablist">
              <TabButton active={tab === "mcp"} icon={Server} label="MCP 服务" count={counts[0]} onClick={() => { setTab("mcp"); closeEditor(); }} />
              <TabButton active={tab === "skills"} icon={Sparkles} label="Skills" count={counts[1]} onClick={() => { setTab("skills"); closeEditor(); }} />
              <TabButton active={tab === "agents"} icon={Bot} label="子 Agent" count={counts[2]} onClick={() => { setTab("agents"); closeEditor(); }} />
              <TabButton active={tab === "memory"} icon={Brain} label="记忆管理" onClick={() => { setTab("memory"); closeEditor(); }} />
            </div>
            <div className="mt-auto hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_88%,var(--background))] px-3 py-2.5 shadow-sm md:flex md:items-center md:gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] text-[var(--primary)]"><FileCode2 className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
              <p className="min-w-0 whitespace-normal break-words text-xs font-medium leading-5 text-[var(--foreground)]">配置内容对当前笔记本生效</p>
            </div>
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            <div className="mx-auto max-w-[720px] px-5 py-6 sm:px-8">
              {error && <InlineError message={error} />}
              {tab === "mcp" && <>
                <SectionHeader title="MCP 服务" description="为这个笔记本里的 Agent 添加可调用的外部工具与数据源。" action={<Button size="sm" onClick={() => openMcp(null)} disabled={!!editor}><Plus />添加</Button>} />
                {editor?.kind === "mcp" && mcpForm && <McpEditor form={mcpForm} onChange={(patch) => setMcpForm((current) => current ? { ...current, ...patch } : current)} onCancel={closeEditor} onSave={saveMcpDraft} error={formError} saving={false} />}
                <McpList workspace={workspace ?? EMPTY_WORKSPACE} onAdd={() => openMcp(null)} onEdit={openMcp} onDelete={deleteMcp} onToggle={toggleMcp} />
              </>}
              {tab === "skills" && <>
                <SectionHeader title="Skills" description="把可复用的工作流程保存为 Markdown Skill，之后可被不同 Agent 使用。" action={<Button size="sm" onClick={() => openFile("skill", null)} disabled={!!editor}><Plus />创建</Button>} />
                {editor?.kind === "file" && editor.fileKind === "skill" && fileForm && <FileEditor kind="skill" form={fileForm} onChange={(patch) => setFileForm((current) => current ? { ...current, ...patch } : current)} onCancel={closeEditor} onSave={saveFileDraft} error={formError} />}
                <FileList kind="skill" items={(workspace ?? EMPTY_WORKSPACE).skills} onAdd={() => openFile("skill", null)} onEdit={(id) => openFile("skill", id)} onDelete={(id) => deleteFile("skill", id)} onToggle={(id, enabled) => toggleFile("skill", id, enabled)} />
              </>}
              {tab === "agents" && <>
                <SectionHeader title="子 Agent" description="创建专门角色，让主 Agent 可以把任务交给更合适的处理者。" action={<Button size="sm" onClick={() => openFile("agent", null)} disabled={!!editor}><Plus />创建</Button>} />
                {editor?.kind === "file" && editor.fileKind === "agent" && fileForm && <FileEditor kind="agent" form={fileForm} onChange={(patch) => setFileForm((current) => current ? { ...current, ...patch } : current)} onCancel={closeEditor} onSave={saveFileDraft} error={formError} />}
                <FileList kind="agent" items={(workspace ?? EMPTY_WORKSPACE).agents} onAdd={() => openFile("agent", null)} onEdit={(id) => openFile("agent", id)} onDelete={(id) => deleteFile("agent", id)} onToggle={(id, enabled) => toggleFile("agent", id, enabled)} />
              </>}
              {tab === "memory" && <div className="flex min-h-full flex-col items-center justify-center py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--muted)_72%,var(--background))] text-[var(--muted-foreground)]"><Brain className="h-5 w-5" strokeWidth={1.7} /></span>
                <h2 className="mt-4 text-base font-semibold tracking-[-0.02em] text-[var(--foreground)]">记忆管理</h2>
                <p className="mt-1 max-w-[34ch] text-sm leading-6 text-[var(--muted-foreground)]">当前还没有可管理的笔记本记忆。</p>
              </div>}
            </div>
          </main>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--divider)] bg-[color-mix(in_oklch,var(--background)_92%,var(--card))] px-5 py-3 sm:px-6">
          <div className="min-w-0 text-xs text-[var(--muted-foreground)]">{dirty ? <span className="text-[var(--primary)]">有未保存更改</span> : <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--primary)]" />已与磁盘同步</span>}</div>
          <div className="flex items-center gap-2"><Button type="button" variant="ghost" onClick={requestClose}>取消</Button><Button type="button" disabled={!dirty || saving} onClick={() => void saveWorkspace()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}保存更改</Button></div>
        </footer>
      </div>
    </div>
  );
}

export class NotebookAgentSettingsDialogController {
  private container: HTMLDivElement | null = null;
  private root: Root | null = null;

  open(notebookPath: string): void {
    this.close();
    const container = document.createElement("div");
    container.dataset.notebookAgentSettingsDialog = "true";
    document.body.append(container);
    this.container = container;
    this.root = createRoot(container);
    this.root.render(<NotebookAgentSettingsDialog notebookPath={notebookPath} onClose={() => this.close()} />);
  }

  close(): void {
    this.root?.unmount();
    this.root = null;
    this.container?.remove();
    this.container = null;
  }
}
