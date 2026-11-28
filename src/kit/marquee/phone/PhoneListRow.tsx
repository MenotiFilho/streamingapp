import { Icon, type IconName } from "../icons";
import { PhoneSwitchMark } from "./controls";

export type PhoneListRowProps = {
  icon: IconName;
  label: string;
  disabled?: boolean;
} & (
  | {
      /** A value with a chevron: a press opens what holds the choice. */
      kind: "value";
      value?: string | null;
      onPress: () => void;
    }
  | {
      /** A switch the row toggles. */
      kind: "switch";
      checked: boolean;
      onChange: (next: boolean) => void;
    }
  | {
      /** Nothing trails: the icon says what a press does, such as adding. */
      kind: "action";
      onPress: () => void;
    }
);

/** A Settings row at hand scale, 60px (sheet `C8`, "List row · phone"). */
export function PhoneListRow(props: PhoneListRowProps) {
  const { icon, label, disabled = false } = props;
  const toggles = props.kind === "switch";

  return (
    <button
      type="button"
      className="mq-ph mq-ph-list mq-focus-row"
      data-focusable
      data-kind={props.kind}
      role={toggles ? "switch" : undefined}
      aria-checked={props.kind === "switch" ? props.checked : undefined}
      disabled={disabled}
      onClick={() => {
        if (props.kind === "switch") {
          props.onChange(!props.checked);
        } else {
          props.onPress();
        }
      }}
    >
      <Icon name={icon} size={22} className="mq-ph-list-icon" />
      <span className="mq-ph-list-label">{label}</span>
      {props.kind === "value" ? (
        <span className="mq-ph-list-trailing">
          {props.value ? <span className="mq-ph-list-value">{props.value}</span> : null}
          <Icon name="caret-right" size={16} className="mq-ph-list-caret" />
        </span>
      ) : null}
      {props.kind === "switch" ? <PhoneSwitchMark on={props.checked} /> : null}
    </button>
  );
}
