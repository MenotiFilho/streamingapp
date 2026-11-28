import { useState } from "react";

import { explain, type ActionError } from "../core/errors";
import type { Level, NewLevel } from "../core/navigation";
import type { PreferenceSubLevelId } from "../core/marqueeSettings";
import type { Session, SessionState } from "../core/session";
import type { SettingsCategoryId } from "../core/settingsRegister";
import type { Action, Title, Video } from "../core/wire";
import { Button } from "../kit/Button";
import { Confirm } from "../kit/marquee/Confirm";
import { AddonDetails } from "./Addons";
import { PlayerCard } from "./Player";
import { PlayerSheets } from "./PlayerSheets";
import { PreferenceSubLevel, SettingsLeaf } from "./Settings";
import { StreamsScreen } from "./StreamsScreen";
import { TitleScreen } from "./TitleScreen";
import { playerLevel, type RemotePlayer } from "./playerScreen";
import type { RemoteSheet } from "./playerSheets";
import { streamsLevelFor } from "./titleScreen";

export type RemoteTitle = {
  addon: string | null;
  id: string;
  type: string;
  name: string;
};

export type RemoteConfirm = {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  action: Action;
};

export type RemotePayload =
  | { kind: "title"; title: RemoteTitle; answer: Title | null }
  | { kind: "streams"; title: Title; video: Video }
  | { kind: "addon-details"; addonId: string }
  | { kind: "settings"; category: SettingsCategoryId }
  | { kind: "settings-pref"; subLevel: PreferenceSubLevelId }
  | { kind: "confirm"; confirm: RemoteConfirm }
  | RemotePlayer
  | RemoteSheet;

export function isSheetPayload(payload: RemotePayload): boolean {
  return payload.kind === "sheet" || payload.kind === "confirm";
}

export function levelTitle(payload: RemotePayload): Title | null {
  switch (payload.kind) {
    case "title":
      return payload.answer;
    case "streams":
      return payload.title;
    case "player":
    case "sheet":
      return payload.title;
    default:
      return null;
  }
}

export function heldTitle(
  levels: ReadonlyArray<Level<RemotePayload>>,
): Title | null {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const title = levelTitle(levels[index]!.payload);
    if (title) {
      return title;
    }
  }
  return null;
}

export function titleLevel(title: RemoteTitle): NewLevel<RemotePayload> {
  return {
    name: "Title",
    kind: "overlay",
    payload: { kind: "title", title, answer: null },
  };
}

export function titleLevelOf(
  addon: string | null,
  meta: { id: string; type: string; name: string },
): NewLevel<RemotePayload> {
  return titleLevel({ addon, id: meta.id, type: meta.type, name: meta.name });
}

export function RemoteLevel({
  level,
  session,
  state,
  deviceId = null,
  push,
  pop,
}: {
  level: Level<RemotePayload>;
  session: Session;
  state: SessionState;
  deviceId?: string | null;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
}) {
  const { payload } = level;

  switch (payload.kind) {
    case "title":
      return (
        <TitleScreen
          levelId={level.id}
          card={payload.title}
          answer={payload.answer}
          session={session}
          state={state}
          push={push}
          pop={pop}
        />
      );
    case "streams":
      return (
        <StreamsScreen
          title={payload.title}
          video={payload.video}
          session={session}
          state={state}
          pop={pop}
          onOpened={() => {
            pop();
            push(playerLevel(payload.title));
          }}
        />
      );
    case "addon-details":
      return (
        <AddonDetails
          addonId={payload.addonId}
          session={session}
          state={state}
          push={push}
          pop={pop}
        />
      );
    case "settings":
      return (
        <SettingsLeaf
          category={payload.category}
          session={session}
          state={state}
          deviceId={deviceId}
          push={push}
          pop={pop}
        />
      );
    case "settings-pref":
      return (
        <PreferenceSubLevel
          subLevel={payload.subLevel}
          session={session}
          state={state}
          pop={pop}
        />
      );
    case "confirm":
      return (
        <ConfirmLevel
          confirm={payload.confirm}
          session={session}
          pop={pop}
        />
      );
    case "player":
      return (
        <div className="remote-level">
          <div className="remote-level-page">
            <div className="remote-level-head">
              <Button variant="ghost" onClick={pop}>
                Back
              </Button>
              <span className="remote-level-rule" aria-hidden="true" />
            </div>
            <PlayerCard
              title={payload.title}
              session={session}
              push={push}
            />
          </div>
        </div>
      );
    case "sheet":
      return (
        <PlayerSheets
          plate={payload.plate}
          title={payload.title}
          session={session}
          state={state}
          onClose={pop}
          onEpisode={(title, video) => {
            pop();
            push(streamsLevelFor(title, video));
          }}
        />
      );
  }
}

function ConfirmLevel({
  confirm,
  session,
  pop,
}: {
  confirm: RemoteConfirm;
  session: Session;
  pop: () => void;
}) {
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, setPending] = useState(false);

  const answer = async () => {
    if (pending) {
      return;
    }
    setError(null);
    setPending(true);
    const outcome = await session.ask(confirm.action);
    setPending(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    pop();
  };

  return (
    <div data-testid={confirm.id}>
      <Confirm
        title={confirm.title}
        body={
          <>
            <p>{confirm.body}</p>
            {error ? (
              <p role="alert" className="mq-remote-inline-error">
                {explain(error)}
              </p>
            ) : null}
          </>
        }
        confirmLabel={confirm.confirmLabel}
        cancelLabel="Cancel"
        danger
        pending={pending}
        onConfirm={() => void answer()}
        onCancel={pop}
      />
    </div>
  );
}
