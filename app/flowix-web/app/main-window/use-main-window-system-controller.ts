import { useAppUpdatePreferences } from '@features/preferences/public/app-api';
import {
  useAppUpdater,
  type AppUpdaterState,
} from '@features/shell/public/system-api';

export interface MainWindowSystemController {
  updater: AppUpdaterState;
}

export function useMainWindowSystemController(): MainWindowSystemController {
  const updatePreferences = useAppUpdatePreferences();
  const updater = useAppUpdater({
    autoCheck: !updatePreferences.loading,
    autoInstall: true,
    enabled: updatePreferences.enabled,
  });
  return { updater };
}
