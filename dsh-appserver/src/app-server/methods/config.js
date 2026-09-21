import { ConfigService } from '../services/config-service.js'

export function configMethods(adapter) {
  const service = adapter.configService || new ConfigService(adapter.ctx)
  return {
    'config/read': p => service.read(p.namespace),
    'config/value/write': p => service.writeValue(p),
    'config/batchWrite': p => service.batchWrite(p),
    'configRequirements/read': p => service.requirements(p.namespace),
  }
}
