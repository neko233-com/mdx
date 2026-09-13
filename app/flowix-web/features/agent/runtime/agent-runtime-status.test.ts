import { describe, expect, it } from 'vitest';

import {
  normalizeAgentRuntimeStatus,
  normalizeAgentRuntimeStatusByType,
} from './agent-runtime-status';

describe('normalizeAgentRuntimeStatus', () => {
  it('distinguishes an unchecked runtime from a runtime being checked', () => {
    expect(normalizeAgentRuntimeStatus(undefined)).toEqual({
      state: 'unknown',
      reason: null,
    });
    expect(normalizeAgentRuntimeStatus(undefined, true)).toEqual({
      state: 'checking',
      reason: null,
    });
  });

  it('maps an unavailable runtime without installation to not-installed', () => {
    expect(normalizeAgentRuntimeStatus({
      available: false,
      installed: false,
      reason: 'CLI not configured',
    })).toEqual({
      state: 'not-installed',
      reason: 'CLI not configured',
    });
  });

  it('keeps installed-but-unready distinct from not-installed', () => {
    expect(normalizeAgentRuntimeStatus({
      available: false,
      installed: true,
      reason: 'No model configured',
    })).toEqual({
      state: 'not-ready',
      reason: 'No model configured',
    });
  });

  it('supports legacy payloads that only contain available', () => {
    expect(normalizeAgentRuntimeStatus({ available: true })).toEqual({
      state: 'ready',
      reason: null,
    });
    expect(normalizeAgentRuntimeStatus({ available: false })).toEqual({
      state: 'not-installed',
      reason: null,
    });
  });
});

describe('normalizeAgentRuntimeStatusByType', () => {
  it('normalizes the known entries without inventing missing entries', () => {
    expect(normalizeAgentRuntimeStatusByType({
      codex: { available: true, installed: true },
      claude: { available: false, installed: true, reason: 'Needs setup' },
    })).toEqual({
      codex: { state: 'ready', reason: null },
      claude: { state: 'not-ready', reason: 'Needs setup' },
    });
  });
});
