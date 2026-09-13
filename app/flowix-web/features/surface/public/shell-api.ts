export {
  WorkColumnSurfaceHost,
  getWorkColumnSurfaceDefinition,
  surfaceSupports,
} from '@features/surface/registry';
export { resolveWorkColumnSurface } from '@features/surface/resolver';
export {
  BrowserColumnSurfaceHost,
  getBrowserColumnSurfaceDefinition,
  type BrowserColumnFlushRegistration,
  type BrowserColumnSurface,
  type BrowserColumnSurfaceChrome,
} from '@features/surface/browser-column-registry';
export { resolveBrowserColumnSurface } from '@features/surface/browser-column-registry';
