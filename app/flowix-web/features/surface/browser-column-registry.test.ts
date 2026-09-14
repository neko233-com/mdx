import { describe, expect, it } from 'vitest';
import { browserColumnSurfaceRegistry } from './browser-column-registry';

describe('browserColumnSurfaceRegistry', () => {
  it('assigns Agent chrome only to Agent conversation surfaces', () => {
    expect(browserColumnSurfaceRegistry['agent-conversation'].chrome).toBe('agent');
    expect(browserColumnSurfaceRegistry.document.chrome).toBe('document');
    expect(browserColumnSurfaceRegistry['file-browser'].chrome).toBe('document');
    expect(browserColumnSurfaceRegistry.web.chrome).toBe('document');
    expect(browserColumnSurfaceRegistry.artifact.chrome).toBe('document');
  });
});
