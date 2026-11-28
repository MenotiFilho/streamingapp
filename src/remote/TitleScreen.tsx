import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { actionKey } from "../core/actionKey";
import { answeredTitle } from "../core/answers";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
import {
  episodeAirNote,
  episodeProgress,
  titleActionsModel,
  titleBackdropCandidates,
} from "../core/marqueeTitle";
import type { NewLevel } from "../core/navigation";
import { useRevisedTitle } from "../core/react/useRevisedTitle";
import type { Session, SessionState } from "../core/session";
import {
  nameOf,
  seasonName,
  type Season,
} from "../core/title";
import {
  titleFacts,
  titleMainPress,
  titlePlayOutcome,
  unmappedOf,
} from "../core/titlePage";
import type { Title } from "../core/wire";
import { useArtChain } from "../kit/marquee/cards";
import { Chip } from "../kit/marquee/Chip";
import { EmptyState } from "../kit/marquee/EmptyState";
import { GroupLabel } from "../kit/marquee/GroupLabel";
import { PhoneEpisodeRow } from "../kit/marquee/phone/PhoneEpisodeRow";
import { PhoneHeader } from "../kit/marquee/phone/PhoneHeader";
import { PhoneButton, PhoneIconButton } from "../kit/marquee/phone/controls";
import type { RemotePayload, RemoteTitle } from "./levels";
import { playerLevel } from "./playerScreen";
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
  levelId: string;
  card: RemoteTitle;
  answer: Title | null;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop?: () => void;
};

const STICKY_HEADER_SCROLL = 260;

export function TitleScreen({
  levelId,
  card,
  answer,
  session,
  state,
  push,
  pop,
}: TitleScreenProps) {
  const [waiting, setWaiting] = useState(
    answer === null && titleOpenAction(card) !== null,
  );
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [empty, setEmpty] = useState(false);

  const alive = useRef(true);
  const asked = useRef<string | null>(null);

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
    setFailure(null);
    setEmpty(false);
    setWaiting(true);
    const outcome = await session.ask(action);
    if (!alive.current) {
      return;
    }
    setWaiting(false);
    if (outcome.error) {
      setFailure(outcome.error);
      return;
    }
    const resolved = answeredTitle(outcome.response);
    if (!resolved) {
      setEmpty(true);
      return;
    }
    push(answeredTitleLevel(card, resolved, levelId));
  }, [card, levelId, push, session]);

  useEffect(() => {
    if (answer !== null || asked.current === levelId || titleOpenAction(card) === null) {
      return;
    }
    asked.current = levelId;
    void open();
  }, [answer, card, levelId, open]);

  if (answer !== null) {
    return (
      <AnsweredTitleView
        card={card}
        title={answer}
        session={session}
        state={state}
        push={push}
        pop={pop}
      />
    );
  }

  return (
    <section
      className="mq-remote-title-level"
      aria-label={card.name}
      data-testid="remote-title-screen"
    >
      {pop ? <PhoneHeader title={card.name} onBack={pop} /> : null}

      {titleOpenAction(card) === null ? (
        <EmptyState
          icon="film"
          title={card.name}
          body={TITLE_UNOPENABLE}
        />
      ) : waiting ? (
        <p className="mq-remote-waiting" role="status" data-testid="title-loading">
          {TITLE_LOOKING}
        </p>
      ) : failure ? (
        <EmptyState
          icon="triangle-alert"
          title={`Could not open ${card.name}`}
          body={explain(failure)}
          action={{ label: TITLE_RETRY, onPress: () => void open() }}
        />
      ) : empty ? (
        <EmptyState
          icon="film"
          title={card.name}
          body={TITLE_NO_ANSWER}
          action={{ label: TITLE_RETRY, onPress: () => void open() }}
        />
      ) : null}
    </section>
  );
}

function AnsweredTitleView({
  card,
  title: answered,
  session,
  state,
  push,
  pop,
}: {
  card: RemoteTitle;
  title: Title;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop?: () => void;
}) {
  const title = useRevisedTitle(answered, session);
  const snapshot = state.snapshot;
  const fallback = cardPreviewOf(card);
  const name = nameOf(title, fallback);

  const continueWatching = snapshot?.continueWatching ?? [];
  const watchProgress = snapshot?.watchProgress ?? [];
  const upNextPlayback = snapshot?.preferences.upNextPlayback ?? "direct";
  const suppliedBy = title.addon ? addonLabel(snapshot, title.addon) : null;
  const isUnmapped = unmappedOf(title);
  const facts = useMemo(() => titleFacts(title), [title]);

  const backdropChain = useMemo(
    () => titleBackdropCandidates(title, null),
    [title],
  );
  const [backdropSrc, failBackdrop] = useArtChain(backdropChain);
  const [logoSrc, failLogo] = useArtChain([title.logo]);

  const initialModel = titleActionsModel({
    title,
    continueWatching,
    upNextPlayback,
  });
  const seasons = initialModel.side.kind === "series" ? initialModel.side.seasons : [];
  const [chosenSeason, setChosenSeason] = useState<number | null>(
    initialModel.anchor.season,
  );
  const shownSeason: Season | undefined =
    seasons.find((season) => season.season === chosenSeason) ?? seasons[0];
  const selectedVideo =
    (initialModel.anchor.video &&
    shownSeason?.videos.some((video) => video.id === initialModel.anchor.video?.id)
      ? initialModel.anchor.video
      : shownSeason?.videos[0]) ?? null;

  const model = titleActionsModel({
    title,
    continueWatching,
    upNextPlayback,
    selectedVideo,
  });
  const { main, chooseStream } = model;
  const press = titleMainPress(main);
  const waiting =
    press !== null &&
    press.kind !== "picker" &&
    state.pending.has(actionKey(press.action));

  const [playError, setPlayError] = useState<ActionError | null>(null);
  const [compactHeader, setCompactHeader] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setCompactHeader(window.scrollY >= STICKY_HEADER_SCROLL);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const triggerMain = async () => {
    if (!press || waiting) {
      return;
    }
    setPlayError(null);
    if (press.kind === "picker") {
      push(streamsLevelFor(title, press.video));
      return;
    }
    if (press.kind === "resume") {
      if (await session.take(press.action)) {
        push(playerLevel(title));
      }
      return;
    }
    const { response, error } = await session.ask(press.action);
    switch (titlePlayOutcome(error)) {
      case "picker":
        push(streamsLevelFor(title, press.video));
        return;
      case "report":
        setPlayError(error);
        return;
      case "played":
        if (response) {
          push(playerLevel(title));
        }
        return;
    }
  };

  const today = useMemo(() => new Date(), []);
  const factsLine = useMemo(() => facts.map((item) => item.text).join(" · "), [facts]);

  const stickySubtitle =
    [title.releaseInfo, title.genres[0]].filter(Boolean).join(" · ") || undefined;

  return (
    <section
      className="mq-remote-title-level"
      aria-label={name}
      data-testid="remote-title-screen"
    >
      <div className="mq-remote-title-top">
        {pop && compactHeader ? (
          <div className="mq-remote-title-sticky" data-testid="title-sticky-header">
            <PhoneHeader title={name} subtitle={stickySubtitle} onBack={pop} />
          </div>
        ) : pop ? (
          <PhoneIconButton
            icon="arrow-left"
            label="Back"
            kind="secondary"
            size="l"
            className="mq-remote-title-back"
            onClick={pop}
          />
        ) : null}
      </div>

      <div className="mq-remote-title-hero">
        {backdropSrc ? (
          <img
            src={backdropSrc}
            alt=""
            className="mq-remote-title-hero-art"
            onError={() => {
              if (backdropSrc) {
                failBackdrop(backdropSrc);
              }
            }}
          />
        ) : null}
        <span className="mq-remote-title-hero-scrim-top" aria-hidden="true" />
        <span className="mq-remote-title-hero-scrim-bottom" aria-hidden="true" />
      </div>

      <div className="mq-remote-title-hero-copy">
        {logoSrc ? (
          <>
            <img
              src={logoSrc}
              alt={name}
              className="mq-remote-title-logo"
              onError={() => {
                if (logoSrc) {
                  failLogo(logoSrc);
                }
              }}
            />
            <h1 className="mq-remote-visually-hidden">{name}</h1>
          </>
        ) : (
          <h1 className="mq-remote-title-name">{name}</h1>
        )}

        {factsLine ? (
          <p className="mq-remote-title-facts" data-testid="title-facts">
            {factsLine}
          </p>
        ) : null}
      </div>

      <div className="mq-remote-title-body">
        <div className="mq-remote-title-actions">
          {main ? (
            <PhoneButton
              kind="primary"
              icon="play"
              filled
              disabled={waiting}
              data-testid="title-main-action"
              onClick={() => void triggerMain()}
            >
              {waiting ? "Starting…" : main.label}
            </PhoneButton>
          ) : null}

          {chooseStream ? (
            <PhoneButton
              kind={chooseStream.primary ? "primary" : "secondary"}
              icon="episodes"
              data-testid="title-choose-stream"
              onClick={() => push(streamsLevelFor(title, chooseStream.video))}
            >
              {chooseStream.primary ? FIND_STREAMS : "Choose stream"}
            </PhoneButton>
          ) : null}
        </div>

        {playError ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(playError)}
          </p>
        ) : null}

        {title.description ? (
          <p className="mq-remote-title-synopsis" data-testid="title-synopsis">
            {title.description}
          </p>
        ) : null}

        {suppliedBy ? (
          <p className="mq-remote-title-meta-note" data-testid="title-source">
            Supplied by {suppliedBy}
          </p>
        ) : null}

        {isUnmapped ? (
          <p className="mq-remote-title-meta-note" data-testid="title-unmapped">
            {TITLE_UNMAPPED}
          </p>
        ) : null}

        {seasons.length > 0 && shownSeason ? (
          <div className="mq-remote-title-episodes" data-testid="title-episodes">
            <div className="mq-remote-chips" role="tablist" aria-label="Seasons">
              {seasons.map((season) => (
                <Chip
                  key={season.season}
                  selected={season.season === shownSeason.season}
                  data-testid={`season-${season.season}`}
                  onClick={() => setChosenSeason(season.season)}
                >
                  {seasonName(season.season)}
                </Chip>
              ))}
            </div>

            <GroupLabel>
              {`${seasonName(shownSeason.season)} · ${shownSeason.videos.length} ${shownSeason.videos.length === 1 ? "episode" : "episodes"}`}
            </GroupLabel>

            <div className="mq-remote-episodes-list">
              {shownSeason.videos.map((video) => {
                const epNum = video.episode ?? 1;
                const epCode =
                  video.season !== null && video.episode !== null
                    ? `S${video.season} E${video.episode}`
                    : undefined;
                const epProgress = episodeProgress(video.id, watchProgress);
                return (
                  <div key={video.id} data-testid={`episode-${video.id}`}>
                    <PhoneEpisodeRow
                      number={`Episode ${epNum}`}
                      title={video.name?.trim() || (epCode ?? video.id)}
                      date={episodeAirNote(video, today)}
                      description={video.description}
                      still={video.thumbnail}
                      code={epCode}
                      progress={epProgress.progress}
                      onPress={() => push(streamsLevelFor(title, video))}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
