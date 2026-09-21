import { requiredString } from '../protocol/json-rpc.js'
import { SkillCatalogService } from '../services/skill-catalog-service.js'

/** DSH-owned human command and skill discovery bridge. */
export function commandMethods(adapter) {
  const catalog = adapter.skillCatalog || new SkillCatalogService(adapter.ctx, { resolveAgent: adapter.resolveAgent })
  return {
    'thread/command': async p => adapter.executeCommand(
      requiredString(p.threadId, 'threadId'),
      requiredString(p.command, 'command'),
      Array.isArray(p.attachments) ? p.attachments : [],
    ),
    'thread/skills': async p => adapter.listSkills
      ? adapter.listSkills(requiredString(p.threadId, 'threadId'))
      : catalog.listForThread(requiredString(p.threadId, 'threadId')),
    'skills/list': p => catalog.list({ cwds: p.cwds, forceReload: p.forceReload === true, threadId: p.threadId }),
    'skills/config/write': p => catalog.writeConfig(p),
    'skills/extraRoots/set': p => catalog.setExtraRoots(p),
  }
}
