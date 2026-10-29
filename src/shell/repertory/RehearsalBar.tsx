import { useRepertorySettings } from "./context";
import {
  FEATURE_OPTIONS,
  FRAME_OPTIONS,
  PAIRING_OPTIONS,
  type RepertorySettings,
} from "./settings";

function Group<T extends string>({
  label,
  options,
  value,
  onChoose,
}: {
  label: string;
  options: readonly { id: T; label: string; note?: string }[];
  value: T;
  onChoose: (id: T) => void;
}) {
  return (
    <div className="rep-rehearsal-group">
      <span>{label}</span>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.note}
          data-selected={option.id === value ? "true" : undefined}
          aria-pressed={option.id === value}
          onClick={() => onChoose(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The rehearsal bar: prototype scaffolding for comparing the two frames, the
 * two pairings and the two feature models. It sits outside the shell's focus
 * root on purpose — it is not a Host control and never reaches a Snapshot.
 */
export function RehearsalBar() {
  const { settings, update } = useRepertorySettings();
  const choose = <K extends keyof RepertorySettings>(key: K, value: RepertorySettings[K]) =>
    update({ [key]: value } as Partial<RepertorySettings>);

  return (
    <div
      className="rep-rehearsal"
      role="group"
      aria-label="Repertory prototype settings"
      data-testid="repertory-rehearsal"
    >
      <span className="rep-rehearsal-label">Rehearsal</span>
      <Group
        label="Frame"
        options={FRAME_OPTIONS}
        value={settings.frame}
        onChoose={(frame) => choose("frame", frame)}
      />
      <Group
        label="Type"
        options={PAIRING_OPTIONS}
        value={settings.pairing}
        onChoose={(pairing) => choose("pairing", pairing)}
      />
      <Group
        label="Feature"
        options={FEATURE_OPTIONS}
        value={settings.feature}
        onChoose={(feature) => choose("feature", feature)}
      />
    </div>
  );
}
