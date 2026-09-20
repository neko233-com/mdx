'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { mediaResources, type MediaResource } from '@platform/tauri/client';
import { resourceKindFromPath } from '@features/editor/public/code-file';

interface PropertyDraft {
  id: string;
  key: string;
  value: string;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('[') && trimmed.endsWith(']'))
    || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function draftsFromResource(resource: MediaResource): PropertyDraft[] {
  return Object.entries(resource.properties).map(([key, value], index) => ({
    id: `${key}-${index}`,
    key,
    value: displayValue(value),
  }));
}

export function MediaPropertiesPanel({
  filePath,
  notebookPath,
  onClose,
}: {
  filePath: string;
  notebookPath: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const kind = resourceKindFromPath(filePath);
  const [resource, setResource] = useState<MediaResource | null>(null);
  const [rows, setRows] = useState<PropertyDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const rowsRef = useRef<PropertyDraft[]>([]);
  const resourceRef = useRef<MediaResource | null>(null);
  const editVersionRef = useRef(0);
  const failedVersionRef = useRef<number | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    resourceRef.current = resource;
  }, [resource]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResource(null);
    resourceRef.current = null;
    setRows([]);
    rowsRef.current = [];
    setDirty(false);
    editVersionRef.current = 0;
    failedVersionRef.current = null;
    void mediaResources.get(filePath, notebookPath).then((response) => {
      if (cancelled) return;
      const nextRows = draftsFromResource(response.resource);
      setResource(response.resource);
      setRows(nextRows);
      rowsRef.current = nextRows;
      resourceRef.current = response.resource;
      setDirty(false);
      setLoading(false);
    }).catch((reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, notebookPath]);

  const markDirty = () => {
    editVersionRef.current += 1;
    failedVersionRef.current = null;
    setDirty(true);
  };

  const updateRow = (id: string, patch: Partial<PropertyDraft>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    markDirty();
  };

  const save = useCallback(async () => {
    const currentResource = resourceRef.current;
    if (!currentResource || saving) return false;
    const versionAtSave = editVersionRef.current;
    const properties: Record<string, unknown> = {};
    for (const row of rowsRef.current) {
      const key = row.key.trim();
      if (key) properties[key] = parseValue(row.value);
    }
    setSaving(true);
    try {
      const response = await mediaResources.update(
        filePath,
        notebookPath,
        currentResource.id,
        properties,
        currentResource.propertiesRevision,
      );
      resourceRef.current = response.resource;
      setResource(response.resource);
      if (versionAtSave === editVersionRef.current) {
        failedVersionRef.current = null;
        setDirty(false);
      }
      return true;
    } catch (reason) {
      failedVersionRef.current = versionAtSave;
      const message = reason instanceof Error ? reason.message : String(reason);
      toast.error(message.includes('properties changed')
        ? t('media.properties.conflict')
        : message || t('media.properties.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [filePath, notebookPath, saving, t]);

  useEffect(() => {
    if (!dirty || !resource || saving || failedVersionRef.current === editVersionRef.current) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [dirty, resource, rows, saving, save]);

  const close = async () => {
    if (dirty && !saving && failedVersionRef.current !== editVersionRef.current) {
      const saved = await save();
      if (!saved) return;
    }
    onClose();
  };

  if (kind !== 'image' && kind !== 'video') return null;

  return (
    <aside className="m-1 flex h-[calc(100%-0.5rem)] w-[300px] min-w-[260px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex h-9 shrink-0 items-center border-b border-[color-mix(in_oklch,var(--border)_68%,transparent)] px-3">
        <span className="text-xs font-medium text-[var(--foreground)]">
          {t('media.properties.title')}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted-foreground)]">{t('media.properties.loading')}</div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-[var(--destructive)]">{error}</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="flex items-start gap-1.5">
                  <input
                    value={row.key}
                    onChange={(event) => updateRow(row.id, { key: event.target.value })}
                    placeholder={t('media.properties.key')}
                    className="h-8 w-[96px] shrink-0 rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-[var(--primary)]"
                    aria-label={t('media.properties.key')}
                  />
                  <textarea
                    value={row.value}
                    onChange={(event) => updateRow(row.id, { value: event.target.value })}
                    placeholder={t('media.properties.value')}
                    rows={1}
                    className="min-h-8 min-w-0 flex-1 resize-y rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--primary)]"
                    aria-label={row.key || t('media.properties.value')}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setRows((current) => current.filter((candidate) => candidate.id !== row.id));
                      markDirty();
                    }}
                    className="flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                    aria-label={t('media.properties.remove')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {rows.length === 0 && (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--border)] px-3 py-5 text-center text-xs text-[var(--muted-foreground)]">
                {t('media.properties.empty')}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setRows((current) => [...current, { id: `new-${Date.now()}`, key: '', value: '' }]);
                markDirty();
              }}
              className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg px-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('media.properties.add')}
            </button>
          </div>
        </>
      )}
      <div className="p-3">
        <button
          type="button"
          onClick={() => void close()}
          className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"
        >
          {t('media.properties.close')}
        </button>
      </div>
    </aside>
  );
}
