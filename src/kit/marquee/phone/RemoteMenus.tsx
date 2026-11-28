import { Icon, type IconName } from "../icons";

export type RemoteMenu =
  | "subtitles"
  | "picture"
  | "streams"
  | "episodes"
  | "speed"
  | "chapters"
  | "details";

/** The seven menus in the sheet's order, each with its glyph. */
export const REMOTE_MENUS: ReadonlyArray<{ id: RemoteMenu; label: string; icon: IconName }> = [
  { id: "subtitles", label: "Subtitles", icon: "captions" },
  { id: "picture", label: "Picture", icon: "picture" },
  { id: "streams", label: "Streams", icon: "list-video" },
  { id: "episodes", label: "Episodes", icon: "episodes" },
  { id: "speed", label: "Speed", icon: "gauge" },
  { id: "chapters", label: "Chapters", icon: "chapters" },
  { id: "details", label: "Details", icon: "stats" },
];

export type RemoteMenusProps = {
  /** The menus the Stream has: a film has no Episodes. */
  menus?: ReadonlyArray<RemoteMenu>;
  /** The menu whose sheet is open. */
  open?: RemoteMenu | null;
  onOpen: (menu: RemoteMenu) => void;
  disabled?: boolean;
};

/** The remote's menus: each opens the same bottom sheet (sheet `C8`). */
export function RemoteMenus({ menus, open = null, onOpen, disabled = false }: RemoteMenusProps) {
  return (
    <div className="mq-ph-menus" role="group" aria-label="Playback menus">
      {REMOTE_MENUS.filter(({ id }) => !menus || menus.includes(id)).map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          className="mq-ph mq-ph-menu"
          data-focusable
          aria-haspopup="dialog"
          aria-expanded={open === id}
          disabled={disabled}
          onClick={() => onOpen(id)}
        >
          <span className="mq-ph-menu-disc">
            <Icon name={icon} size={22} />
          </span>
          <span className="mq-ph-menu-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
