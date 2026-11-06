import { useCallback, useState } from "react";

import type { Title, Video } from "../../core/wire";
import { theFilm } from "../../core/stream";
import {
  labelOf,
  nameOf,
  seasonName,
  titleArtOf,
  type OpenablePreview,
} from "../../core/title";
import { useShell } from "../context";
import { addonLabel } from "../../core/home";
import { Icon } from "../../kit/icons";
import { ChoiceChip } from "../../kit/Chip";
import { StreamsLoader } from "../StreamsScreen";
import { pageFit } from "../../core/pageLayout";
import { programIndex } from "./program";
import { titleFacts, titleSide, unmappedOf } from "../../core/titlePage";

/**
 * One Title as a single-screen programme page: the backdrop stays the page,
 * the wordmark, facts and description stand on the left, and the right rail
 * carries what a person does next — the film's Streams control, or a series'
 * season chips over its episode stills. The page is sized to one screen; a
 * long episode list scrolls inside its own rail.
 *
 * The Title is still the client's own (ADR-0005). Opening a Video asks the Host
 * for its Streams and pushes the list as another level, leaving this page and
 * the chosen episode exactly where they were.
 */
export function RepertoryTitleScreen({
  title,
  preview,
}: {
  title: Title;
  preview?: OpenablePreview | null;
}) {
  const { snapshot, pop, push } = useShell();
  const side = titleSide(title);
  const seasons = side.kind === "series" ? side.seasons : [];
  const [shownSeason, setShownSeason] = useState<number | null>(seasons[0]?.season ?? null);
  const [selected, setSelected] = useState<Video | null>(null);

  const name = nameOf(title, preview);
  const facts = titleFacts(title, preview);
  const art = titleArtOf(title, preview);
  const shown = seasons.find((season) => season.season === shownSeason) ?? seasons[0];
  const suppliedBy = title.addon ? addonLabel(snapshot, title.addon) : null;
  const fit = pageFit("title");

  const play = useCallback(
    (video: Video) => {
      setSelected(video);
      push({
        name: "Streams",
        kind: "overlay",
        payload: {
          render: () => (
            <StreamsLoader title={title} preview={preview} video={video} />
          ),
        },
      });
    },
    [preview, push, title],
  );

  return (
    <div
      className="rep-title-level"
      data-page={fit.fitted ? "fitted" : undefined}
      data-panel={fit.panel ?? undefined}
    >
      <article
        className="rep-title"
        data-testid={`title-${title.id}`}
        data-region="title"
        data-kind="branch"
        data-label={name}
        aria-label={name}
      >
        <div className="rep-title-backdrop" data-art={art.kind} aria-hidden="true">
          {art.src ? <img className="rep-title-art" src={art.src} alt="" /> : null}
          <span className="rep-title-scrim" />
        </div>

        <header className="rep-title-top">
          <button
            type="button"
            className="rep-button rep-title-back"
            data-focusable
            autoFocus
            onClick={pop}
          >
            Back
          </button>
        </header>

        <div className="rep-title-grid">
          <section className="rep-title-copy">
            {title.logo ? (
              <img
                className="rep-title-logo"
                data-testid="title-logo"
                src={title.logo}
                alt={name}
              />
            ) : (
              <h1 className="rep-title-name" data-testid="title-name">
                {name}
              </h1>
            )}

            {facts.length > 0 ? (
              <div className="rep-title-facts" data-testid="title-facts" aria-label="Facts">
                {facts.map((fact) =>
                  fact.role === "rating" ? (
                    <span key={`${fact.role}:${fact.text}`} className="rep-title-rating" data-role={fact.role}>
                      {fact.text}
                    </span>
                  ) : (
                    <span key={`${fact.role}:${fact.text}`} data-role={fact.role}>
                      {fact.text}
                    </span>
                  ),
                )}
              </div>
            ) : null}

            {title.description ? (
              <p className="rep-title-description">{title.description}</p>
            ) : null}

            <div className="rep-title-attribution">
              {suppliedBy ? <span>{`Supplied by ${suppliedBy}`}</span> : null}
              {unmappedOf(title) ? (
                <span className="rep-title-unmapped" data-testid="title-unmapped">
                  Unmapped — no TMDB record met this Title, so it is keyed by its Addon.
                </span>
              ) : null}
            </div>
          </section>

          <aside
            className="rep-title-side"
            data-testid="title-side"
            data-kind={side.kind === "series" ? "series" : "film"}
          >
            {side.kind === "series" ? (
              <section
                className="rep-title-program"
                data-region="title-seasons"
                data-kind="row"
                data-label="Seasons"
              >
                <div className="rep-title-seasons" data-testid="title-seasons">
                  {seasons.map(({ season }, index) => (
                    <ChoiceChip
                      key={season ?? "unnumbered"}
                      className="rep-season"
                      data-testid={`season-${season ?? "unnumbered"}`}
                      pressed={shown?.season === season}
                      onClick={() => setShownSeason(season)}
                    >
                      <span>{programIndex(index + 1)}</span>
                      <span>{seasonName(season)}</span>
                    </ChoiceChip>
                  ))}
                </div>

                <div
                  className="rep-title-episodes"
                  data-testid="title-episodes"
                  data-region="title-episodes"
                  data-kind="row"
                  data-label="Episodes"
                >
                  {shown?.videos.map((video) => {
                    const label = labelOf(video);
                    return (
                      <button
                        key={video.id}
                        type="button"
                        className="rep-episode"
                        data-focusable
                        data-testid={`episode-${video.id}`}
                        aria-pressed={selected?.id === video.id}
                        onClick={() => play(video)}
                      >
                        {video.thumbnail ? (
                          <span className="rep-episode-still">
                            <img
                              data-testid="episode-still"
                              src={video.thumbnail}
                              alt=""
                              loading="lazy"
                            />
                          </span>
                        ) : (
                          <span className="rep-episode-still rep-episode-plate">
                            <span className="rep-episode-plate-label">
                              {label ?? "Video"}
                            </span>
                          </span>
                        )}
                        <span className="rep-episode-copy">
                          {video.thumbnail ? (
                            <span className="rep-episode-label">{label ?? "Video"}</span>
                          ) : null}
                          <span className="rep-episode-name">{video.name ?? video.id}</span>
                        </span>
                        <span className="rep-episode-mark">Streams</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="rep-title-film">
                {side.kind === "series-empty" ? (
                  <>
                    <p className="rep-title-side-kicker">{side.kicker}</p>
                    <p className="rep-title-side-note" data-testid="title-no-videos">
                      {side.note}
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rep-play"
                    data-focusable
                    data-testid="play-film"
                    onClick={() => play(theFilm(title))}
                  >
                    <Icon name="play" className="rep-play-mark" />
                    <span>Find Streams</span>
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      </article>
    </div>
  );
}

/** The Title page while the Host is still answering: the card's art, and its name. */
export function RepertoryTitleLoading({ preview }: { preview: OpenablePreview }) {
  const { pop } = useShell();
  const art = preview.background ?? preview.poster ?? null;
  const fit = pageFit("title");

  return (
    <div
      className="rep-title-level"
      data-page={fit.fitted ? "fitted" : undefined}
      data-panel={fit.panel ?? undefined}
    >
      <section
        className="rep-title rep-title-loading"
        data-testid="title-loading"
        data-region="title"
        data-kind="branch"
        data-label={`Opening ${preview.name}`}
        aria-label={`Opening ${preview.name}`}
      >
        <div
          className="rep-title-backdrop"
          data-art={preview.background ? "background" : preview.poster ? "poster" : "none"}
          aria-hidden="true"
        >
          {art ? <img className="rep-title-art" src={art} alt="" /> : null}
          <span className="rep-title-scrim" />
        </div>
        <header className="rep-title-top">
          <button
            type="button"
            className="rep-button rep-title-back"
            data-focusable
            autoFocus
            onClick={pop}
          >
            Back
          </button>
        </header>
        <div className="rep-title-grid rep-title-grid--loading">
          <section className="rep-title-copy">
            <h1 className="rep-title-name">{preview.name}</h1>
            <p className="rep-title-note" data-testid="title-loading-note">
              Looking for this Title…
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
