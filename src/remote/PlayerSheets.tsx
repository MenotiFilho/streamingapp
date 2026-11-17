import { useEffect, useState } from "react";

import { actionKey } from "../core/actionKey";
import { episodesOf } from "../core/episodes";
import type { PanelGroup, PanelRow } from "../core/playerPanels";
import type { Session, SessionState } from "../core/session";
import { seasonName } from "../core/title";
import type { Title, Video } from "../core/wire";
import { MenuGroup, MenuReadout, MenuRow } from "../kit/Menu";
import { Sheet } from "../kit/Sheet";
import {
  PROTO,
  useTorrentProto,
  withTorrentStatistics,
} from "../prototype/torrent307";
import {
  episodeLabel,
  NO_EPISODES,
  SHEET_TITLES,
  sheetGroups,
  type PlayerSheetName,
} from "./playerSheets";

export type PlayerSheetsProps = {
  /** Which plate the card opened. */
  plate: PlayerSheetName;
  /** The Title the player belongs to, which the Episodes plate lists. */
  title: Title | null;
  /** The Session every row's Action goes through. */
  session: Session;
  /** What the Host last published: the playback facts and the pending keys. */
  state: SessionState;
  /** Put the sheet away: its close control, its scrim, or the client's Back. */
  onClose: () => void;
  /**
   * Open the Streams list for one episode. An episode is a Video like any
   * other, so the plate hands the pair to the room, which puts the sheet away
   * and pushes the Streams level the Title's Play pushes (#215).
   */
  onEpisode: (title: Title, video: Video) => void;
};

/**
 * The Remote player's one sheet, one plate at a time (#214, ADR-0035 §2).
 *
 * Every plate is the core's own rows drawn through the kit: Audio & Subtitles
 * composes `audioSection` and `subtitleSections` in that order, Picture is
 * `pictureSections`, Speed is `speedSection`, Chapters is `chaptersSection`, and
 * Episodes is `episodesOf`, and a press there is the room's: it opens the
 * Streams level for that episode, which is the same list the Title's Play
 * opens. A choice or action row sends the Action the core chose; the statistics
 * row has no Action and opens the readout this client owns; a note or readout is
 * never a press.
 */
export function PlayerSheets({
  plate,
  title,
  session,
  state,
  onClose,
  onEpisode,
}: PlayerSheetsProps) {
  const protoView = useTorrentProto();
  const [showStatistics, setShowStatistics] = useState(
    () => PROTO && protoView.stateId === "playing",
  );
  useEffect(() => {
    if (PROTO && protoView.stateId === "playing") {
      setShowStatistics(true);
    }
  }, [protoView.stateId]);

  const playback = state.snapshot?.playback ?? null;

  // The card is popped with the Stream, so a sheet over nothing is no sheet.
  if (!playback) {
    return null;
  }

  const groups = withTorrentStatistics(
    sheetGroups(
      plate,
      playback,
      state.snapshot?.preferences.subtitleScale ?? 1,
      showStatistics,
    ),
    playback,
    protoView.variant,
  );

  return (
    <Sheet
      open
      title={SHEET_TITLES[plate]}
      onClose={onClose}
      testId={`player-sheet-${plate}`}
    >
      {plate === "episodes" ? (
        <EpisodesPlate title={title} onEpisode={onEpisode} />
      ) : (
        <Sections
          groups={groups}
          session={session}
          state={state}
          onStatistics={() => setShowStatistics((shown) => !shown)}
        />
      )}
    </Sheet>
  );
}

/** The core's groups as this client's headed rows, in the core's order. */
function Sections({
  groups,
  session,
  state,
  onStatistics,
}: {
  groups: PanelGroup[];
  session: Session;
  state: SessionState;
  onStatistics: () => void;
}) {
  return (
    <>
      {groups.map((group, index) => (
        // A delay group's title carries the value in force, so the group's
        // place is its identity: keying by the title would remount the row a
        // press left the person on.
        <MenuGroup key={index} title={group.title}>
          {group.rows.map((row) => (
            <Row
              key={row.key}
              row={row}
              session={session}
              state={state}
              onStatistics={onStatistics}
            />
          ))}
        </MenuGroup>
      ))}
    </>
  );
}

/** One row: a press that takes its Action, the client's toggle, or a readout. */
function Row({
  row,
  session,
  state,
  onStatistics,
}: {
  row: PanelRow;
  session: Session;
  state: SessionState;
  onStatistics: () => void;
}) {
  if (row.kind === "note") {
    return (
      <p className="rep-kit-menu-note" data-testid={row.key}>
        {row.text}
      </p>
    );
  }

  if (row.kind === "readout") {
    return (
      <MenuReadout
        testId={row.key}
        label={row.label}
        value={row.value}
        lines={row.lines}
      />
    );
  }

  const pending = row.action ? state.pending.has(actionKey(row.action)) : false;

  return (
    <MenuRow
      testId={row.key}
      label={row.label}
      pressed={row.pressed}
      marks={row.kind === "choice" ? row.marks : undefined}
      disabled={row.disabled}
      pending={pending}
      onPress={() => {
        // A row with its own Action is the Host's; a null Action is this
        // client's state, which today is only the statistics toggle.
        if (row.action) {
          void session.take(row.action);
        } else {
          onStatistics();
        }
      }}
    >
      {row.text ?? row.label}
    </MenuRow>
  );
}

/**
 * The Episodes plate: the Title's seasons in the Addon's order, one press per
 * episode. A press asks for that Video's Streams and plays the first candidate
 * this Host can open through the core's `play_stream`; where there is none, the
 * plate says so in the core's words and sends nothing.
 */
function EpisodesPlate({
  title,
  onEpisode,
}: {
  title: Title | null;
  onEpisode: (title: Title, video: Video) => void;
}) {
  const seasons = title ? episodesOf(title) : [];

  if (!title || seasons.length === 0) {
    return (
      <p className="rep-kit-menu-note" role="status" data-testid="episode-note">
        {NO_EPISODES}
      </p>
    );
  }

  return (
    <>
      {seasons.map(({ season, videos }) => (
        <MenuGroup key={season ?? "none"} title={seasonName(season)}>
          {videos.map((video) => {
            const label = episodeLabel(video);
            return (
              <MenuRow
                key={video.id}
                testId={`episode-${video.id}`}
                label={label}
                onPress={() => onEpisode(title, video)}
              >
                {label}
              </MenuRow>
            );
          })}
        </MenuGroup>
      ))}
    </>
  );
}
