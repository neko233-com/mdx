import type { AppUpdaterState } from '@features/shell/public/system-api';
import { FloatingPromptStack } from '@features/shell/components/floating-prompt';
import { AppUpdatePrompt } from '@features/shell/components/prompts/app-update-prompt';
import { NavigationFailurePrompt } from '@features/shell/components/prompts/navigation-failure-prompt';

export interface MainPromptHostProps {
  updater: AppUpdaterState;
}

export function MainPromptHost({ updater }: MainPromptHostProps) {
  return (
    <FloatingPromptStack>
      <NavigationFailurePrompt />
      <AppUpdatePrompt updater={updater} />
    </FloatingPromptStack>
  );
}

