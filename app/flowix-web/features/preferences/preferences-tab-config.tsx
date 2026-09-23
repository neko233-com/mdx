import { EjectIcon } from '@phosphor-icons/react';
import {
  Cloud,
  FileCog,
  History,
  Keyboard,
  Link2,
  Palette,
  Settings,
  SquareMousePointer,
  SquareTerminal,
  Type,
} from 'lucide-react';
import type { I18nKey } from '@/lib/i18n';
import type { SettingsTab } from '@features/preferences/sections';

export type PreferencesTabItem = {
  id: SettingsTab;
  labelKey: I18nKey;
  icon: React.ReactNode;
};

export type PreferencesTabGroup = {
  labelKey: I18nKey;
  tabs: readonly PreferencesTabItem[];
};

/** Shared order and icons for the Preferences sidebar and product menu. */
export const PREFERENCE_TAB_GROUPS: readonly PreferencesTabGroup[] = [
  {
    labelKey: 'preferences.groups.features',
    tabs: [
      { id: 'general', labelKey: 'preferences.tabs.general', icon: <Settings className="w-4 h-4" /> },
      { id: 'format', labelKey: 'preferences.tabs.format', icon: <Type className="w-4 h-4" /> },
      { id: 'theme', labelKey: 'preferences.tabs.theme', icon: <Palette className="w-4 h-4" /> },
      { id: 'noteSettings', labelKey: 'preferences.tabs.noteSettings', icon: <FileCog className="w-4 h-4" /> },
      { id: 'shortcuts', labelKey: 'preferences.tabs.shortcuts', icon: <Keyboard className="w-4 h-4" /> },
      { id: 'history', labelKey: 'preferences.tabs.history', icon: <History className="w-4 h-4" /> },
      { id: 'cloudSync', labelKey: 'preferences.tabs.cloudSync', icon: <Cloud className="w-4 h-4" /> },
    ],
  },
  {
    labelKey: 'preferences.groups.ai',
    tabs: [
      { id: 'mcp', labelKey: 'preferences.tabs.mcp', icon: <EjectIcon className="w-4 h-4" weight="regular" /> },
      { id: 'cli', labelKey: 'preferences.tabs.cli', icon: <SquareTerminal className="w-4 h-4" /> },
      { id: 'connections', labelKey: 'preferences.tabs.connections', icon: <Link2 className="w-4 h-4" /> },
      { id: 'tools', labelKey: 'preferences.tabs.tools', icon: <SquareMousePointer className="w-4 h-4" /> },
    ],
  },
];

export const PREFERENCE_TABS: readonly PreferencesTabItem[] = PREFERENCE_TAB_GROUPS.flatMap(
  (group) => group.tabs,
);
