import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { answeredStreams } from "../core/answers";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
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
} from "../core/marqueeStreams";
import type { Session, SessionState } from "../core/session";
import {
  playStreamAction,
  playabilityNote,
} from "../core/stream";
import type { AddonStreams, Stream, Title, Video } from "../core/wire";
import { Chip } from "../kit/marquee/Chip";
import { EmptyState } from "../kit/marquee/EmptyState";
import { GroupLabel } from "../kit/marquee/GroupLabel";
import { PhoneBadge } from "../kit/marquee/phone/controls";
import { PhoneAddonNotice } from "../kit/marquee/phone/PhoneAddonNotice";
import { PhoneHeader } from "../kit/marquee/phone/PhoneHeader";
import { PhoneStreamRow } from "../kit/marquee/phone/PhoneStreamRow";
import { streamsAsk, unplayableAfter } from "./streamsScreen";

export type StreamsScreenProps = {
  title: Title;
  video: Video;
  session: Session;
  state: SessionState;
  pop?: () => void;
  onOpened: () => void;
};

/**
 * Streams (`P6`): Addon filter `Chip`s, `GroupLabel` per Addon,
 * `PhoneStreamRow` candidates with verbatim warnings & unplayable flags, and
 * `PhoneAddonNotice` with **Try again** per failing Addon.
 */
export function StreamsScreen({
  title,
  video,
  session,
  state,
  pop,
  onOpened,
}: StreamsScreenProps) {
  const [waiting, setWaiting] = useState(true);
  const [failure, setFailure] = useState<ActionError | null>(null);
  const [groups, setGroups] = useState<AddonStreams[]>([]);
  const [selectedAddon, setSelectedAddon] = useState<string | null>(null);
  const [retryingAddons, setRetryingAddons] = useState<Set<string>>(() => new Set());
  const [opening, setOpening] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const key = `${title.type}:${video.id}`;
  const asked = useRef<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    setWaiting(true);
    const outcome = await session.ask(streamsAsk(title, video));
    if (!alive.current) {
      return;
    }
    setWaiting(false);
    if (outcome.error) {
      setFailure(outcome.error);
      return;
    }
    const answered = answeredStreams(outcome.response);
    setGroups(answered);
    const settlement = unplayableAfter(answered);
    if (settlement !== null) {
      session.markUnplayable(title.id, settlement);
    }
  }, [session, title, video]);

  useEffect(() => {
    if (asked.current === key) {
      return;
    }
    asked.current = key;
    void load();
  }, [key, load]);

  const retryAddon = async (addonId: string) => {
    setRetryingAddons((prev) => new Set(prev).add(addonId));
    const outcome = await session.ask(streamsAsk(title, video));
    if (!alive.current) {
      return;
    }
    setRetryingAddons((prev) => {
      const next = new Set(prev);
      next.delete(addonId);
      return next;
    });
    if (outcome.error) {
      return;
    }
    const answered = answeredStreams(outcome.response);
    setGroups((current) => {
      const merged = mergeRetriedAddonGroup(current, addonId, answered);
      const settlement = unplayableAfter(merged);
      if (settlement !== null) {
        session.markUnplayable(title.id, settlement);
      }
      return merged;
    });
  };

  const play = async (addon: string, stream: Stream) => {
    if (opening || playabilityNote(stream.playback) !== null) {
      return;
    }
    setOpening(true);
    try {
      const action = playStreamAction(title, video, addon, stream);
      if (await session.take(action)) {
        onOpened();
      }
    } finally {
      if (alive.current) {
        setOpening(false);
      }
    }
  };

  const addons = state.snapshot?.addons ?? [];
  const activeAddon = resolveSelectedAddon(selectedAddon, groups);
  const chips = useMemo(() => addonFilterChips(groups, addons), [addons, groups]);
  const visibleGroups = useMemo(
    () => filterStreamGroups(groups, activeAddon),
    [activeAddon, groups],
  );
  const countSubtitle = streamsPanelSubtitle(groups, activeAddon, addons);
  const parts = streamsSubjectParts(title, null, video);
  const subjectParts =
    parts.heading !== parts.titleName
      ? [parts.titleName, parts.overline, parts.heading]
      : [parts.titleName, parts.overline];
  const subjectSubtitle = subjectParts.filter(Boolean).join(" · ");
  const headerSubtitle = subjectSubtitle || countSubtitle;
  const empty = activeAddon === null ? streamsEmptyState(groups) : null;

  return (
    <section
      className="mq-remote-streams"
      aria-label="Streams"
      data-testid="remote-streams-screen"
    >
      <PhoneHeader
        title="Streams"
        subtitle={headerSubtitle}
        onBack={pop ?? onOpened}
      />

      {waiting ? (
        <p className="mq-remote-waiting" role="status" data-testid="streams-loading">
          Looking for Streams…
        </p>
      ) : failure ? (
        <div className="mq-remote-streams-body" data-testid="streams-failure">
          <EmptyState
            icon="triangle-alert"
            title="Could not load Streams"
            body={explain(failure)}
            action={{ label: "Try again", onPress: () => void load() }}
          />
        </div>
      ) : (
        <div className="mq-remote-streams-body">
          {subjectSubtitle ? (
            <p className="mq-remote-title-meta-note" data-testid="streams-summary">
              {countSubtitle}
            </p>
          ) : null}

          {chips.length > 0 ? (
            <div className="mq-remote-chips" data-testid="streams-filter">
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
            <div data-testid="streams-none">
              <EmptyState icon="film" title={empty.title} body={empty.body} />
            </div>
          ) : (
            visibleGroups.map((group) => {
              const addonName = addonLabel(state.snapshot, group.addon);
              const note =
                group.streams.length === 0 && !group.failure
                  ? "No Streams from this Addon."
                  : null;
              const showLabel =
                group.streams.length > 0 || note !== null || group.failure !== null;

              return (
                <section
                  key={group.addon}
                  className="mq-remote-streams-group"
                  data-addon={group.addon}
                  data-testid={`streams-${group.addon}`}
                >
                  {showLabel ? <GroupLabel>{addonName}</GroupLabel> : null}

                  {group.streams.length > 0 ? (
                    <ol className="mq-remote-streams-list">
                      {group.streams.map((stream, index) => {
                        const view = streamRowView(stream);
                        const unplayableReason = playabilityNote(stream.playback);
                        const canPlay = unplayableReason === null;
                        const playing = isPlayingStream(
                          state.snapshot?.playback,
                          group.addon,
                          video,
                          stream,
                        );
                        const details =
                          [view.peers, view.size, view.source].filter(Boolean).join(" · ") ||
                          null;
                        const tierKind: "4k" | "hd" =
                          view.tier?.toUpperCase() === "4K" ? "4k" : "hd";
                        const qualityLabel = view.tier ?? "HD";

                        return (
                          <li
                            key={index}
                            className="mq-remote-stream-slot"
                            data-testid={`candidate-${group.addon}-${index}`}
                          >
                            <PhoneStreamRow
                              tier={tierKind}
                              quality={qualityLabel}
                              name={view.name}
                              details={details}
                              marks={view.marks}
                              playing={playing}
                              disabled={!canPlay || opening}
                              onPlay={() => void play(group.addon, stream)}
                            >
                              {view.warnings.map((warning) => (
                                <PhoneBadge
                                  key={warning.tag}
                                  tone="neutral"
                                  title={warning.note}
                                  aria-label={warning.note}
                                >
                                  {warning.tag}
                                </PhoneBadge>
                              ))}
                              {unplayableReason ? (
                                <PhoneBadge
                                  tone="danger"
                                  title={unplayableReason}
                                  aria-label={unplayableReason}
                                  data-testid="stream-unplayable"
                                >
                                  Unplayable
                                </PhoneBadge>
                              ) : null}
                            </PhoneStreamRow>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}

                  {group.failure ? (
                    <PhoneAddonNotice
                      title={addonName}
                      reason={explain(group.failure)}
                      disabled={retryingAddons.has(group.addon)}
                      onRetry={() => void retryAddon(group.addon)}
                    />
                  ) : note ? (
                    <p className="mq-remote-row-note">{note}</p>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
