import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { answeredStreams } from "../../core/answers";
import { explain, type ActionError } from "../../core/errors";
import { addonLabel } from "../../core/home";
import {
  addonFilterChips,
  filterStreamGroups,
  isPlayingStream,
  mergeRetriedAddonGroup,
  resolveSelectedAddon,
  streamRowView,
  streamsEmptyState,
  streamsPanelSubtitle,
  streamsSubjectParts,
} from "../../core/marqueeStreams";
import { titleBackdropCandidates } from "../../core/marqueeTitle";
import { unplayableNote } from "../../core/stream";
import { groupAnswerNote } from "../../core/streamsList";
import type { OpenablePreview } from "../../core/title";
import type { AddonStreams, Title, Video } from "../../core/wire";
import { AddonNotice } from "../../kit/marquee/AddonNotice";
import { Badge } from "../../kit/marquee/Badge";
import { useArtChain } from "../../kit/marquee/cards";
import { Chip } from "../../kit/marquee/Chip";
import { EmptyState } from "../../kit/marquee/EmptyState";
import { GroupLabel } from "../../kit/marquee/GroupLabel";
import { Panel } from "../../kit/marquee/Panel";
import { StreamRow } from "../../kit/marquee/StreamRow";
import { useShell } from "../context";
import { useStreamChoice } from "../streamChoice";
import "./title-streams.css";

function applyUnplayableMark(
  titleId: string,
  groups: readonly AddonStreams[],
  markUnplayable: (titleId: string, unplayable: boolean) => void,
) {
  if (groups.some((group) => group.streams.length > 0)) {
    markUnplayable(titleId, false);
  } else if (groups.every((group) => group.failure === null)) {
    markUnplayable(titleId, true);
  }
}

/**
 * The Marquee Streams level loader: opens immediately over the Title backdrop
 * while the Host asks every configured Stream Addon, and swaps in the list
 * (with per-Addon filter chips and per-Addon **Try again**) once answered.
 */
export function MarqueeStreamsLoader({
  title,
  preview,
  video,
  onOpened,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  onOpened?: () => void;
}) {
  const { ask, pop, markUnplayable } = useShell();
  const [state, setState] = useState<
    { groups: AddonStreams[] } | { failure: ActionError } | null
  >(null);
  const [retryingAddons, setRetryingAddons] = useState<ReadonlySet<string>>(() => new Set());
  const mounted = useRef(true);
  // Which Video the list on screen belongs to: a retry that answers after the
  // Video changed must not merge into the new Video's groups.
  const videoKey = `${title.type}:${title.id}:${video.id}`;
  const shownVideo = useRef(videoKey);
  shownVideo.current = videoKey;
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    void ask({
      type: "find_streams",
      video: { type: title.type, id: video.id },
    }).then(({ response, error }) => {
      if (cancelled) {
        return;
      }
      if (error) {
        setState({ failure: error });
        return;
      }
      const groups = answeredStreams(response);
      applyUnplayableMark(title.id, groups, markUnplayable);
      setState({ groups });
    });
    return () => {
      cancelled = true;
    };
  }, [ask, markUnplayable, reloadCount, title.id, title.type, video.id]);

  const retryAddon = useCallback(
    async (addonId: string) => {
      if (retryingAddons.has(addonId)) {
        return;
      }
      setRetryingAddons((current) => new Set(current).add(addonId));
      const askedFor = `${title.type}:${title.id}:${video.id}`;
      try {
        const { response, error } = await ask({
          type: "find_streams",
          video: { type: title.type, id: video.id },
        });
        if (!mounted.current || shownVideo.current !== askedFor) {
          return;
        }
        setState((current) => {
          if (!current || !("groups" in current)) {
            return current;
          }
          const nextGroups = error
            ? current.groups.map((group) =>
                group.addon === addonId
                  ? { addon: addonId, streams: [], failure: error }
                  : group,
              )
            : mergeRetriedAddonGroup(current.groups, addonId, answeredStreams(response));
          applyUnplayableMark(title.id, nextGroups, markUnplayable);
          return { groups: nextGroups };
        });
      } finally {
        if (mounted.current) {
          setRetryingAddons((current) => {
            const next = new Set(current);
            next.delete(addonId);
            return next;
          });
        }
      }
    },
    [ask, markUnplayable, retryingAddons, title.id, title.type, video.id],
  );

  if (!state) {
    return (
      <MarqueeStreamsShell
        title={title}
        preview={preview}
        video={video}
        subtitle="Looking for Streams…"
        onClose={pop}
      >
        <p className="mq-streams-loading" role="status" data-testid="streams-loading">
          Looking for Streams…
        </p>
      </MarqueeStreamsShell>
    );
  }

  if ("failure" in state) {
    return (
      <MarqueeStreamsShell title={title} preview={preview} video={video} onClose={pop}>
        <div className="mq-streams-empty" role="alert" data-testid="streams-failure">
          <EmptyState
            icon="triangle-alert"
            title="Could not load Streams"
            body={explain(state.failure)}
            action={{
              label: "Try again",
              icon: "arrow-clockwise",
              onPress: () => setReloadCount((count) => count + 1),
            }}
          />
        </div>
      </MarqueeStreamsShell>
    );
  }

  return (
    <MarqueeStreamsScreen
      title={title}
      preview={preview}
      video={video}
      groups={state.groups}
      retryingAddons={retryingAddons}
      onRetryAddon={(addonId) => void retryAddon(addonId)}
      onOpened={onOpened}
    />
  );
}

/**
 * Marquee Streams picker (`06.jpg`, `docs/design-system.md` §8–§9, #360):
 * - Left: Title backdrop + wordmark/name + Season/Episode heading.
 * - Right: 936×1032 side `Panel` with Addon filter Chips, verbatim Addon-grouped
 *   `StreamRow`s, and `AddonNotice` rows with **Try again**.
 */
export function MarqueeStreamsScreen({
  title,
  preview,
  video,
  groups,
  retryingAddons = new Set(),
  onRetryAddon,
  onOpened,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  groups: AddonStreams[];
  retryingAddons?: ReadonlySet<string>;
  onRetryAddon?: (addonId: string) => void;
  onOpened?: () => void;
}) {
  const { snapshot, pop } = useShell();
  const { chosen, opening, openingStream, choose } = useStreamChoice(
    title,
    preview,
    video,
    onOpened,
  );
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);

  const addons = snapshot?.addons ?? [];
  const activeAddon = resolveSelectedAddon(selectedAddon, groups);
  const chips = useMemo(() => addonFilterChips(groups, addons), [addons, groups]);
  const visibleGroups = useMemo(
    () => filterStreamGroups(groups, activeAddon),
    [activeAddon, groups],
  );
  const subtitle = streamsPanelSubtitle(groups, activeAddon, addons);
  const empty = activeAddon === null ? streamsEmptyState(groups) : null;

  return (
    <MarqueeStreamsShell
      title={title}
      preview={preview}
      video={video}
      subtitle={subtitle}
      onClose={pop}
    >
      {chips.length > 0 ? (
        <div
          className="mq-streams-filter"
          data-testid="streams-filter"
          data-region="streams-filter"
          data-kind="row"
          data-label="Addon filter"
        >
          {chips.map((chip) => (
            <Chip
              key={chip.id ?? "__all__"}
              selected={activeAddon === chip.id}
              data-testid={`streams-filter-${chip.id ?? "all"}`}
              onClick={() => setSelectedAddon(chip.id)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      ) : null}

      {empty ? (
        <div className="mq-streams-empty" data-testid="streams-none">
          <EmptyState icon="film" title={empty.title} body={empty.body} />
        </div>
      ) : (
        visibleGroups.map((group) => {
          const addonName = addonLabel(snapshot, group.addon);
          const note = groupAnswerNote(group);
          const showLabel = group.streams.length > 0 || note !== null;
          return (
            <section
              key={group.addon}
              className="mq-streams-group"
              data-testid={`streams-${group.addon}`}
              data-region={`streams:${group.addon}`}
              data-kind="row"
              data-label={addonName}
            >
              {showLabel ? <GroupLabel>{addonName}</GroupLabel> : null}

              {group.streams.length > 0 ? (
                <ol className="mq-streams-list">
                  {group.streams.map((stream, index) => {
                    const view = streamRowView(stream);
                    const playing = isPlayingStream(
                      snapshot?.playback,
                      group.addon,
                      video,
                      stream,
                    );
                    const isOpening = openingStream === stream;
                    return (
                      <li
                        key={index}
                        data-testid={`candidate-${group.addon}-${index}`}
                      >
                        <StreamRow
                          name={view.name}
                          tier={view.tier}
                          peers={view.peers}
                          size={view.size}
                          source={view.source}
                          marks={view.marks}
                          playing={playing}
                          disabled={opening}
                          onPlay={() => void choose(group.addon, stream)}
                        >
                          {view.warnings.map((warning) => (
                            <Badge
                              key={warning.tag}
                              tone="neutral"
                              title={warning.note}
                              aria-label={warning.note}
                            >
                              {warning.tag}
                            </Badge>
                          ))}
                          {view.unplayable ? (
                            <Badge
                              tone="danger"
                              title={view.unplayable}
                              aria-label={view.unplayable}
                              data-testid="stream-unplayable"
                            >
                              Unplayable
                            </Badge>
                          ) : null}
                          {isOpening ? (
                            <Badge tone="accent" data-testid="stream-opening">
                              Opening…
                            </Badge>
                          ) : null}
                        </StreamRow>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              {group.failure ? (
                <div role="alert" data-testid={`streams-failure-${group.addon}`}>
                  <AddonNotice
                    addon={addonName}
                    reason={explain(group.failure)}
                    pending={retryingAddons.has(group.addon)}
                    onRetry={onRetryAddon ? () => onRetryAddon(group.addon) : undefined}
                  />
                </div>
              ) : null}

              {note ? <p className="mq-streams-note">{note}</p> : null}
            </section>
          );
        })
      )}

      {chosen ? (
        <p role="status" className="mq-streams-status" data-testid="chosen-stream">
          {unplayableNote(chosen)}
        </p>
      ) : null}
    </MarqueeStreamsShell>
  );
}

function MarqueeStreamsShell({
  title,
  preview,
  video,
  subtitle,
  onClose,
  children,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const subject = streamsSubjectParts(title, preview, video);
  const [backdropSrc, failBackdrop] = useArtChain(titleBackdropCandidates(title, preview));
  const [logoSrc, failLogo] = useArtChain([title.logo]);

  return (
    <section
      className="mq-streams-screen"
      data-testid="streams"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject.heading}`}
      aria-label={`Streams — ${subject.heading}`}
    >
      <div className="mq-title-backdrop" aria-hidden="true">
        {backdropSrc ? (
          <img
            className="mq-title-backdrop-img"
            src={backdropSrc}
            alt=""
            draggable={false}
            onError={() => failBackdrop(backdropSrc)}
          />
        ) : null}
        <span className="mq-title-scrim mq-title-scrim--left" />
        <span className="mq-title-scrim mq-title-scrim--bottom" />
        <span className="mq-streams-dim" />
      </div>

      <div className="mq-streams-subject">
        {logoSrc ? (
          <div className="mq-streams-logo-box">
            <img
              className="mq-streams-logo"
              src={logoSrc}
              alt={subject.titleName}
              draggable={false}
              onError={() => failLogo(logoSrc)}
            />
          </div>
        ) : subject.heading !== subject.titleName ? (
          <p className="mq-title-name">{subject.titleName}</p>
        ) : null}
        {subject.overline ? (
          <p className="mq-streams-overline">{subject.overline}</p>
        ) : null}
        <h1 className="mq-streams-heading" data-testid="streams-heading">
          {subject.heading}
        </h1>
      </div>

      <div className="mq-streams-panel-slot">
        <Panel
          placement="side"
          title="Streams"
          subtitle={subtitle}
          onClose={onClose}
          data-region="streams-panel"
          data-kind="branch"
          data-label="Streams"
        >
          {children}
        </Panel>
      </div>
    </section>
  );
}
