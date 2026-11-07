import { useCallback, useEffect, useRef, useState } from "react";

import { answeredTitle } from "../core/answers";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
import { programIndex } from "../core/homeProgramme";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import { theFilm } from "../core/stream";
import {
  labelOf,
  nameOf,
  seasonName,
  titleArtOf,
  type Season,
} from "../core/title";
import { titleFacts, titleSide, unmappedOf } from "../core/titlePage";
import type { Title, Video } from "../core/wire";
import { Button } from "../kit/Button";
import { Chip, ChoiceChip } from "../kit/Chip";
import { Icon } from "../kit/icons";
import type { RemotePayload, RemoteTitle } from "./levels";
import {
  FIND_STREAMS,
  TITLE_LOOKING,
  TITLE_NO_ANSWER,
  TITLE_RETRY,
  TITLE_UNMAPPED,
  TITLE_UNOPENABLE,
  answeredTitleLevel,
  cardPreviewOf,
  streamsLevelFor,
  titleOpenAction,
} from "./titleScreen";

export type TitleScreenProps = {
  /** The level this screen is drawn on: the id an answer replaces. */
  levelId: string;
  /** The card the level was pushed with: what it asks by, and its fallback name. */
  card: RemoteTitle;
  /** The Host's answered Title, where this level already holds one. */
  answer: Title | null;
  /** The Session the one question goes through. */
  session: Session;
  /** What the Host last published: the Addon that supplied the Title. */
  state: SessionState;
  /** Push a level, which is how a Play opens the Streams list. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * The Title level, in a hand (#210, ADR-0035 §1).
 *
 * A card pushes this level with its identity and no Title. On the first mount
 * the level asks the Host the one question the card names — `open_title` for an
 * Addon's card, `open_discovered_title` for a Discovered Title (ADR-0020) — and
 * re-pushes *the same level id* with the answer, so a Streams level above it and
 * a Back find the Title on the stack instead of asking again. One level id is
 * asked once; a refusal is the Host's own words with a way to ask again, and a
 * loading level names the card it is opening.
 *
 * What the page is, once answered, is the core's (`titleFacts`, `titleSide`,
 * `unmappedOf`, `theFilm`); this file only draws it at hand scale. Nothing here
 * opens a player: a Play pushes the Streams list, and B8/B9 own the Remote's
 * player.
 */
export function TitleScreen({
  levelId,
  card,
  answer,
  session,
  state,
  push,
}: TitleScreenProps) {
  const [waiting, setWaiting] = useState(
    answer === null && titleOpenAction(card) !== null,
  );
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [empty, setEmpty] = useState(false);
  // A person can leave the level while the Host is still answering. The answer
  // then belongs to a level that is no longer on the stack, and pushing it
  // would bring the Title back over the destination the person returned to.
  const alive = useRef(true);
  // One question per level id: a re-push with the answer remounts this screen
  // with nothing to ask, and a second render is not a second arrival.
  const asked = useRef<string | null>(null);

  // `StrictMode` runs an effect, cleans it up and runs it again without
  // unmounting the component, so the mount effect re-arms this: a dev render
  // must not discard the answer the second run is waiting for.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    const action = titleOpenAction(card);
    if (action === null) {
      return;
    }
    setWaiting(true);
    setFailure(null);
    setEmpty(false);

    const outcome = await session.ask(action);
    if (!alive.current) {
      return;
    }
    setWaiting(false);
    if (outcome.error) {
      setFailure(outcome.error);
      return;
    }
    const title = answeredTitle(outcome.response);
    if (title === null) {
      setEmpty(true);
      return;
    }
    push(answeredTitleLevel(card, title, levelId));
  }, [card, levelId, push, session]);

  useEffect(() => {
    if (answer !== null || asked.current === levelId) {
      return;
    }
    if (titleOpenAction(card) === null) {
      return;
    }
    asked.current = levelId;
    void open();
  }, [answer, card, levelId, open]);

  if (answer !== null) {
    return (
      <TitlePage card={card} title={answer} state={state} push={push} />
    );
  }

  return (
    <section
      className="remote-title-level"
      aria-label={card.name}
      data-testid="remote-title"
    >
      <h1 className="remote-title-name">{card.name}</h1>

      {failure ? (
        <>
          <p role="alert" className="remote-failure">
            {explain(failure)}
          </p>
          <Button variant="primary" onClick={() => void open()}>
            {TITLE_RETRY}
          </Button>
        </>
      ) : empty ? (
        <>
          <p role="status" className="remote-quiet">
            {TITLE_NO_ANSWER}
          </p>
          <Button variant="primary" onClick={() => void open()}>
            {TITLE_RETRY}
          </Button>
        </>
      ) : waiting ? (
        <p role="status" className="remote-quiet">
          {TITLE_LOOKING}
        </p>
      ) : (
        <p role="status" className="remote-quiet">
          {TITLE_UNOPENABLE}
        </p>
      )}
    </section>
  );
}

/**
 * The Title as the page draws it: the backdrop, the wordmark or name, the facts,
 * the description, the attribution and the one thing a person does next.
 */
function TitlePage({
  card,
  title,
  state,
  push,
}: {
  card: RemoteTitle;
  title: Title;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const preview = cardPreviewOf(card);
  const name = nameOf(title, preview);
  const art = titleArtOf(title, preview);
  const facts = titleFacts(title, null);
  const side = titleSide(title);
  const suppliedBy = title.addon ? addonLabel(state.snapshot, title.addon) : null;

  return (
    <section
      className="remote-title-level"
      aria-label={name}
      data-testid="remote-title"
    >
      <article className="remote-title" data-testid="remote-title-page">
        <div
          className="remote-title-backdrop"
          data-art={art.kind}
          aria-hidden="true"
        >
          {art.src ? (
            <img className="remote-title-art" src={art.src} alt="" loading="lazy" />
          ) : null}
          <span className="remote-title-scrim" />
        </div>

        <div className="remote-title-copy">
          {title.logo ? (
            <img className="remote-title-logo" src={title.logo} alt={name} />
          ) : (
            <h1 className="remote-title-name">{name}</h1>
          )}

          {facts.length > 0 ? (
            <div className="remote-title-facts" aria-label="Facts">
              {facts.map((fact) => (
                <span
                  key={`${fact.role}:${fact.text}`}
                  className="remote-title-fact"
                  data-role={fact.role}
                >
                  {fact.text}
                </span>
              ))}
            </div>
          ) : null}

          {title.description ? (
            <p className="remote-title-description">{title.description}</p>
          ) : null}

          <div className="remote-title-attribution">
            {suppliedBy ? <span>Supplied by {suppliedBy}</span> : null}
            {unmappedOf(title) ? (
              <Chip tone="accent" className="remote-title-unmapped">
                {TITLE_UNMAPPED}
              </Chip>
            ) : null}
          </div>
        </div>

        <aside className="remote-title-side" data-kind={side.kind}>
          {side.kind === "film" ? (
            <Button
              variant="primary"
              className="remote-play"
              onClick={() => push(streamsLevelFor(title, theFilm(title)))}
            >
              <Icon name="play" className="remote-play-mark" />
              <span>{FIND_STREAMS}</span>
            </Button>
          ) : side.kind === "series-empty" ? (
            <div className="remote-title-empty-series">
              <p className="remote-title-kicker">{side.kicker}</p>
              <p className="remote-title-note">{side.note}</p>
            </div>
          ) : (
            <SeriesProgram
              title={title}
              seasons={side.seasons}
              push={push}
            />
          )}
        </aside>
      </article>
    </section>
  );
}

/**
 * A series' side: the season chips, the episodes of the chosen season, the one
 * episode chosen, and the Play that opens its Streams. Which season is folded
 * out and which episode is chosen are this client's own state (ADR-0005); a
 * season change chooses that season's first episode, so Play always has one.
 */
function SeriesProgram({
  title,
  seasons,
  push,
}: {
  title: Title;
  seasons: Season[];
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const [season, setSeason] = useState<number | null>(seasons[0]?.season ?? null);
  const [chosen, setChosen] = useState<Video | null>(
    seasons[0]?.videos[0] ?? null,
  );
  const shown =
    seasons.find((held) => held.season === season) ?? seasons[0];

  const chooseSeason = (next: number | null) => {
    setSeason(next);
    setChosen(
      seasons.find((held) => held.season === next)?.videos[0] ?? null,
    );
  };

  return (
    <section className="remote-title-program" aria-label="Seasons and episodes">
      <div className="remote-title-seasons">
        {seasons.map(({ season: value }, index) => (
          <ChoiceChip
            key={value ?? "unnumbered"}
            className="remote-season"
            data-testid={`season-${value ?? "unnumbered"}`}
            pressed={shown?.season === value}
            onClick={() => chooseSeason(value)}
          >
            <span>{programIndex(index + 1)}</span>
            <span>{seasonName(value)}</span>
          </ChoiceChip>
        ))}
      </div>

      <div className="remote-title-episodes">
        {shown?.videos.map((video) => {
          const label = labelOf(video);
          return (
            <button
              key={video.id}
              type="button"
              className="remote-episode"
              data-focusable
              data-testid={`episode-${video.id}`}
              aria-pressed={chosen?.id === video.id}
              // An episode is a Video like any other: pressing it opens its
              // Streams, as the window does. Choosing it without opening it
              // left the one control a person expects to find behind another
              // press (#215).
              onClick={() => {
                setChosen(video);
                push(streamsLevelFor(title, video));
              }}
            >
              {video.thumbnail ? (
                <img
                  className="remote-episode-still"
                  src={video.thumbnail}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="remote-episode-plate">{label ?? "Video"}</span>
              )}
              <span className="remote-episode-copy">
                {video.thumbnail ? (
                  <span className="remote-episode-label">{label ?? "Video"}</span>
                ) : null}
                <span className="remote-episode-name">
                  {video.name ?? video.id}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Button
        variant="primary"
        className="remote-play"
        disabled={chosen === null}
        onClick={() => {
          if (chosen) {
            push(streamsLevelFor(title, chosen));
          }
        }}
      >
        <Icon name="play" className="remote-play-mark" />
        <span>{FIND_STREAMS}</span>
      </Button>
    </section>
  );
}
