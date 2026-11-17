import { AUTOPLAY_SWITCH_LABEL } from "../core/controls";
import { Switch } from "../kit/Switch";
import { useShell } from "./context";

/**
 * The Autoplay switch the player carries: the Host's one preference, drawn
 * where a person is watching (#302). It shows what the Host last published and
 * takes `set_autoplay`; it holds no state of its own. Flipping it during an
 * episode changes what happens at the end of this one, and on an ended episode
 * the Host starts or stops the countdown.
 */
export function AutoplaySwitch({ className }: { className?: string }) {
  const { snapshot, take } = useShell();

  return (
    <Switch
      on={snapshot?.preferences.autoplay ?? true}
      label={AUTOPLAY_SWITCH_LABEL}
      testId="autoplay-switch"
      className={className}
      onToggle={(autoplay) => void take({ type: "set_autoplay", autoplay })}
    />
  );
}
