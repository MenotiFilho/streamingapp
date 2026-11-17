import { useEffect, useState } from "react";

import { answeredTitle } from "../core/answers";
import { episodesOf, seriesAction, seriesRef } from "../core/episodes";
import { explain, type ActionError } from "../core/errors";
import { seasonName } from "../core/title";
import type { PlaybackSnapshot, Title, Video } from "../core/wire";
import { ChoiceChip } from "../kit/Chip";
import { MenuGroup, MenuRow } from "../kit/Menu";
import { StreamsLoader } from "./StreamsScreen";
import { AutoplaySwitch } from "./AutoplaySwitch";
import { useShell } from "./context";
import {
  EPISODES_EMPTY,
  EPISODES_LOOKING,
  osdEpisodeLabel,
  playingVideoId,
} from "./episodesMenu";

/** What the one series question has answered so far. */
type Lookup =
  | { kind: "waiting" }
  | { kind: "failed"; error: ActionError }
  | { kind: "empty" }
  | { kind: "answered"; title: Title };

/**
 * The Episodes plate: the Autoplay switch at its head, the playing series'
 * seasons as single-select chips, the chosen season's Videos as menu rows, and
 * the episode playing now marked. The plate opens only where the Stream has an
 * Episodes menu, so a film never draws the switch (#302).
 *
 * The series is the core's `seriesRef` — the Watch-progress Title's Addon, the
 * TMDB key, or the Stream's Addon — and the question is the core's
 * `seriesAction`, so the plate cannot grow a second mapping for the same
 * question. A press opens that Video's Streams list, the same picker the
 * Title's Play opens (#215): the plate puts itself away first, and the list puts
 * itself away only once the Host has taken the Stream, which reveals the OSD
 * again.
 */
export function OsdEpisodesMenu({ playback }: { playback: PlaybackSnapshot }) {
  return (
    <>
      <div className="shell-osd-episodes-head">
        <AutoplaySwitch />
      </div>
      <EpisodesPlate playback={playback} />
    </>
  );
}

function EpisodesPlate({ playback }: { playback: PlaybackSnapshot }) {
  const { snapshot, ask, push, remove, pop } = useShell();
  const [lookup, setLookup] = useState<Lookup>({ kind: "waiting" });
  // Which season a person chose. `undefined` has not chosen one, so the first
  // season the Host listed is the one drawn (the numbered seasons come first,
  // ADR-0039); `null` is a real season (the Videos the Addon placed in none).
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);

  const nowPlaying = playback.nowPlaying;
  const series = nowPlaying ? seriesRef(snapshot, nowPlaying) : null;
  const cache = series?.cache ?? null;

  useEffect(() => {
    if (!nowPlaying || !series) {
      setLookup({ kind: "empty" });
      return;
    }
    let live = true;
    setLookup({ kind: "waiting" });
    setChosen(undefined);
    void ask(seriesAction(series)).then(({ response, error }) => {
      if (!live) {
        return;
      }
      if (error) {
        setLookup({ kind: "failed", error });
        return;
      }
      const title = answeredTitle(response);
      setLookup(title ? { kind: "answered", title } : { kind: "empty" });
    });
    return () => {
      live = false;
    };
    // The cache names the series; a later Snapshot about the same series is
    // not a new question, and a new series is.
  }, [ask, cache]);

  const openEpisode = (title: Title, video: Video) => {
    // The plate is furniture above the OSD and Streams is a level above it:
    // putting the plate away first keeps one Back for the list.
    pop();
    const id = push({
      name: "Streams",
      kind: "overlay",
      payload: {
        render: () => (
          <StreamsLoader
            title={title}
            video={video}
            onOpened={() => {
              // The list is spent once the Host has the Stream. Removing it by
              // id is a no-op if a person backed out while the press was on its
              // way, so a late answer cannot pop the surface they are on.
              remove(id);
            }}
          />
        ),
      },
    });
  };

  if (lookup.kind === "waiting") {
    return (
      <p className="rep-kit-menu-note" role="status" data-testid="osd-episodes-note">
        {EPISODES_LOOKING}
      </p>
    );
  }

  if (lookup.kind === "failed") {
    return (
      <p role="alert" className="rep-kit-menu-note" data-testid="osd-episodes-failure">
        {explain(lookup.error)}
      </p>
    );
  }

  const seasons = lookup.kind === "answered" ? episodesOf(lookup.title) : [];
  if (lookup.kind === "empty" || seasons.length === 0) {
    return (
      <p className="rep-kit-menu-note" role="status" data-testid="osd-episodes-note">
        {EPISODES_EMPTY}
      </p>
    );
  }

  const shownSeason = chosen === undefined ? seasons[0]!.season : chosen;
  const shown = seasons.find((season) => season.season === shownSeason) ?? seasons[0]!;
  const playing = playingVideoId(playback);

  return (
    <>
      <div
        className="shell-osd-seasons"
        data-testid="osd-seasons"
        role="group"
        aria-label="Seasons"
      >
        {seasons.map(({ season }) => (
          <ChoiceChip
            key={season ?? "unnumbered"}
            className="shell-osd-season"
            data-testid={`osd-season-${season ?? "unnumbered"}`}
            pressed={shown.season === season}
            onClick={() => setChosen(season)}
          >
            {seasonName(season)}
          </ChoiceChip>
        ))}
      </div>

      <MenuGroup title={seasonName(shown.season)}>
        {shown.videos.map((video) => {
          const label = osdEpisodeLabel(video);
          const now = video.id === playing;
          return (
            <MenuRow
              key={video.id}
              testId={`osd-episode-${video.id}`}
              label={label}
              pressed={now ? true : undefined}
              marks={now ? ["Playing"] : undefined}
              onPress={() => openEpisode(lookup.title, video)}
            >
              {label}
            </MenuRow>
          );
        })}
      </MenuGroup>
    </>
  );
}
