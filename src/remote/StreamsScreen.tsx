import { useEffect, useState } from "react";

import { actionKey } from "../core/actionKey";
import { answeredStreams } from "../core/answers";
import { explain, type ActionError } from "../core/errors";
import { addonLabel } from "../core/home";
import { programIndex } from "../core/homeProgramme";
import type { Session, SessionState } from "../core/session";
import {
  badgeLines,
  playabilityNote,
  playStreamAction,
  streamsSubject,
  unplayableNote,
  warningNote,
} from "../core/stream";
import {
  badgeRole,
  candidateCount,
  candidateCountLabel,
  groupAnswerNote,
} from "../core/streamsList";
import type { Action, AddonStreams, Stream, Title, Video } from "../core/wire";
import {
  SCREENING_LIST,
  STREAM_OPENING,
  STREAMS_LOOKING,
  STREAMS_NONE,
  streamsAsk,
  unplayableAfter,
} from "./streamsScreen";

export type StreamsScreenProps = {
  /** The Title the Video belongs to: what the Watch-progress card is drawn from. */
  title: Title;
  /** The one Video whose candidates this level lists. */
  video: Video;
  /** The Session the one question goes through, and the marks its answer sets. */
  session: Session;
  /** What the Host last published: the Addons a group is named by, and the waits. */
  state: SessionState;
  /**
   * The Stream opened: the room puts this list away and opens the player card,
   * which is where every control for what is now playing lives (#215).
   */
  onOpened: () => void;
};

/** What the one ask has answered so far. */
type LevelAnswer =
  | { kind: "waiting" }
  | { kind: "failed"; error: ActionError }
  | { kind: "answered"; groups: AddonStreams[] };

/**
 * The Streams level, in a hand (#210, ADR-0035 §1).
 *
 * The level asks `find_streams` once, on mount, for the Video it carries, and
 * draws what the Host answered: one group per Addon in the Host's order, each
 * with the Addon's own badge lines verbatim, the release line, the filename,
 * the warnings and whether this Host can open the candidate (#27, ADR-0020).
 *
 * A press on a candidate this Host can open builds the core's `play_stream`
 * once and takes it through the Session; a candidate it cannot stays in the
 * list, marked, and sends nothing. While one is on its way every row is
 * disabled and the pressed one says so — the wait is derived from the Session's
 * pending keys through `actionKey`, never a second lock (ADR-0027). No player
 * level opens here: B8/B9 own the Remote's player.
 */
export function StreamsScreen({
  title,
  video,
  session,
  state,
  onOpened,
}: StreamsScreenProps) {
  const [answer, setAnswer] = useState<LevelAnswer>({ kind: "waiting" });
  /** The unplayable candidate that was pressed, drawn as a note. */
  const [chosen, setChosen] = useState<Stream | null>(null);
  /**
   * The one Action a press sent, and the candidate that names it. The wait is
   * `pending.has(actionKey(action))`: the Session decides it, this remembers
   * which row to say it on.
   */
  const [pressed, setPressed] = useState<{ action: Action; stream: Stream } | null>(
    null,
  );
  const opening = pressed !== null && state.pending.has(actionKey(pressed.action));

  useEffect(() => {
    let live = true;
    void session.ask(streamsAsk(title, video)).then((outcome) => {
      // A person can pop the level while the Host is still asking. The answer
      // then belongs to a list that is no longer on screen, and it does not
      // touch the mark either: a Title nobody is looking at is not judged.
      if (!live) {
        return;
      }
      if (outcome.error) {
        setAnswer({ kind: "failed", error: outcome.error });
        return;
      }
      const groups = answeredStreams(outcome.response);
      // The second half of ADR-0020's unplayable mark: a candidate anywhere
      // clears it; no candidate at all, with every Addon answering, sets it; a
      // failed Addon proves nothing either way and leaves it alone.
      const mark = unplayableAfter(groups);
      if (mark !== null) {
        session.markUnplayable(title.id, mark);
      }
      setAnswer({ kind: "answered", groups });
    });
    return () => {
      live = false;
    };
    // One ask per Video: a new Snapshot is not a new question.
  }, [session, title.id, title.type, video.id]);

  const choose = async (addon: string, stream: Stream) => {
    if (playabilityNote(stream.playback) !== null) {
      setChosen(stream);
      return;
    }
    // One Action, built once by the core. The wait it names is the Session's
    // pending key, not a lock of this screen's: the rows are disabled from the
    // same derivation.
    const action = playStreamAction(title, video, addon, stream);
    setChosen(null);
    setPressed({ action, stream });
    try {
      // The Host taking the Stream is what opens the player: the list has done
      // its job, and the card is where the playing Stream is controlled.
      if (await session.take(action)) {
        onOpened();
      }
    } finally {
      setPressed(null);
    }
  };

  const subject = streamsSubject(title, null, video);
  const groups = answer.kind === "answered" ? answer.groups : [];
  const count = groups.reduce((held, group) => held + group.streams.length, 0);

  return (
    <section
      className="remote-streams"
      aria-label={`Streams — ${subject}`}
      data-testid="remote-streams"
    >
      <div className="remote-streams-heading">
        <p className="remote-streams-kicker">
          <span>{SCREENING_LIST}</span>
          <span className="remote-rule" aria-hidden="true" />
          {answer.kind === "answered" ? (
            <span>{candidateCountLabel(count, groups.length)}</span>
          ) : null}
        </p>
        <h1 className="remote-streams-title">{subject}</h1>
      </div>

      {answer.kind === "waiting" ? (
        <p role="status" className="remote-quiet">
          {STREAMS_LOOKING}
        </p>
      ) : null}

      {answer.kind === "failed" ? (
        <p role="alert" className="remote-failure">
          {explain(answer.error)}
        </p>
      ) : null}

      {answer.kind === "answered" ? (
        <>
          {groups.length === 0 ? (
            <p role="status" className="remote-quiet">
              {STREAMS_NONE}
            </p>
          ) : null}

          {groups.map((group, index) => (
            <StreamGroup
              key={group.addon}
              group={group}
              index={index}
              label={addonLabel(state.snapshot, group.addon)}
              opening={opening}
              pending={pressed?.stream ?? null}
              selected={chosen}
              onChoose={(addon, stream) => void choose(addon, stream)}
            />
          ))}

          {chosen ? (
            <p role="status" className="remote-streams-chosen">
              {unplayableNote(chosen)}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * One Addon's answer: its head, the Host's words where it refused, the core's
 * line where it answered nothing, and its candidates in the Addon's order.
 */
function StreamGroup({
  group,
  index,
  label,
  opening,
  pending,
  selected,
  onChoose,
}: {
  group: AddonStreams;
  index: number;
  label: string;
  opening: boolean;
  /** The candidate whose wait is drawn, where one is on its way. */
  pending: Stream | null;
  /** The unplayable candidate that was pressed, marked where it stands. */
  selected: Stream | null;
  onChoose: (addon: string, stream: Stream) => void;
}) {
  const note = groupAnswerNote(group);

  return (
    <section
      className="remote-stream-group"
      data-testid={`streams-group-${group.addon}`}
      data-addon={group.addon}
    >
      <div className="remote-rail-head">
        <span className="remote-rail-index">{programIndex(index + 1)}</span>
        <h2 className="remote-rail-title">{label}</h2>
        <span className="remote-rail-rule" aria-hidden="true" />
        <span className="remote-rail-tag">
          {candidateCount(group.streams.length)}
        </span>
      </div>

      {group.failure ? (
        <p role="alert" className="remote-failure">
          {explain(group.failure)}
        </p>
      ) : null}

      {note ? (
        <p role="status" className="remote-quiet">
          {note}
        </p>
      ) : null}

      <ol className="remote-stream-list">
        {group.streams.map((stream, at) => (
          <li key={at}>
            <Candidate
              addon={group.addon}
              index={at}
              stream={stream}
              chosen={selected === stream}
              pending={pending === stream}
              disabled={opening}
              onChoose={onChoose}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One candidate: the Addon's own badge lines — the first as the source, the
 * rest as quality marks, verbatim — its release line, its filename, its
 * warnings, and the reason this Host cannot open it, where it cannot. Nothing
 * is hidden for being unplayable: the list is what exists.
 */
function Candidate({
  addon,
  index,
  stream,
  chosen,
  pending,
  disabled,
  onChoose,
}: {
  addon: string;
  index: number;
  stream: Stream;
  chosen: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: (addon: string, stream: Stream) => void;
}) {
  const badges = badgeLines(stream);
  const why = playabilityNote(stream.playback);

  return (
    <button
      type="button"
      className="remote-stream-candidate"
      data-focusable
      data-testid={`stream-${addon}-${index}`}
      data-unplayable={why ? "true" : undefined}
      aria-pressed={chosen}
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={() => onChoose(addon, stream)}
    >
      <span className="remote-stream-index">{programIndex(index + 1)}</span>
      <span className="remote-stream-body">
        {badges.length > 0 ? (
          <span className="remote-stream-badges">
            {badges.map((badge, at) => (
              <span
                key={at}
                className="remote-stream-badge"
                data-role={badgeRole(at)}
              >
                {badge}
              </span>
            ))}
          </span>
        ) : null}

        {stream.description ? (
          <span className="remote-stream-description">{stream.description}</span>
        ) : null}

        {stream.filename ? (
          <span className="remote-stream-file">{stream.filename}</span>
        ) : null}

        {stream.warnings.length > 0 || why ? (
          <span className="remote-stream-notes">
            {stream.warnings.map((warning) => (
              <span key={warning} className="remote-stream-warning">
                {warningNote(warning)}
              </span>
            ))}
            {why ? <span className="remote-stream-unplayable">{why}</span> : null}
          </span>
        ) : null}

        {pending ? (
          <span className="remote-stream-opening" role="status">
            {STREAM_OPENING}
          </span>
        ) : null}
      </span>
      <span className="remote-stream-mark">{why ? "Unplayable" : "Play"}</span>
    </button>
  );
}
