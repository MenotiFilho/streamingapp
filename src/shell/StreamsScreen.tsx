import { useEffect, useState, type ReactNode } from "react";

import {
  answeredStreams,
  explain,
  type ActionError,
  type AddonStreams,
  type Stream,
  type Title,
  type Video,
} from "../host-client";
import {
  badgeLines,
  playabilityNote,
  streamsSubject,
  unplayableNote,
  warningNote,
} from "../stream";
import { isSeries, labelOf, nameOf, type OpenablePreview } from "../title";
import { useShell } from "./context";
import { Button, Chip, PendingSpinner } from "./kit";
import { RepertoryStreamsScreen, RepertoryStreamsWaiting } from "./repertory/RepertoryStreams";
import { useStreamChoice } from "./streamChoice";
import "./streams.css";

/**
 * The Streams level, opened at once: the heading and a waiting line are drawn
 * while the Host asks every Addon, and the same level becomes the list when
 * the answer arrives. A slow Addon is visible as a list being looked for rather
 * than as a press that seemed to do nothing.
 */
export function StreamsLoader({
  title,
  preview,
  video,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
}) {
  const { ask, pop, markUnplayable, presentation } = useShell();
  const subject = streamsSubject(title, preview, video);
  const [state, setState] = useState<{ groups: AddonStreams[] } | { failure: ActionError } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void ask({
      type: "find_streams",
      video: { type: title.type, id: video.id },
    }).then(({ response, error }) => {
      if (cancelled) {
        return;
      }
      if (error) {
        setState({ failure: error });
      } else {
        const groups = answeredStreams(response);
        // The second half of ADR-0020's unplayable mark: no Addon carried a
        // candidate, so this Title is marked in the client that opened it. A
        // candidate anywhere clears the mark; a failed Addon alone proves
        // nothing either way, so the mark is only touched when every group
        // actually answered.
        if (groups.some((group) => group.streams.length > 0)) {
          markUnplayable(title.id, false);
        } else if (groups.every((group) => group.failure === null)) {
          markUnplayable(title.id, true);
        }
        setState({ groups });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ask, markUnplayable, title.id, title.type, video.id]);

  if (!state) {
    return presentation === "repertory" ? (
      <RepertoryStreamsWaiting subject={subject} onBack={pop}>
        <p className="rep-streams-note" data-testid="streams-loading">
          Looking for Streams…
        </p>
      </RepertoryStreamsWaiting>
    ) : (
      <StreamsWaiting subject={subject} onBack={pop}>
        <p className="shell-streams-note" data-testid="streams-loading">
          Looking for Streams…
        </p>
      </StreamsWaiting>
    );
  }

  if ("failure" in state) {
    return presentation === "repertory" ? (
      <RepertoryStreamsWaiting subject={subject} onBack={pop}>
        <p role="alert" className="rep-stream-failure" data-testid="streams-failure">
          {explain(state.failure)}
        </p>
      </RepertoryStreamsWaiting>
    ) : (
      <StreamsWaiting subject={subject} onBack={pop}>
        <p role="alert" className="shell-stream-failure" data-testid="streams-failure">
          {explain(state.failure)}
        </p>
      </StreamsWaiting>
    );
  }

  return presentation === "repertory" ? (
    <RepertoryStreamsScreen
      title={title}
      preview={preview}
      video={video}
      groups={state.groups}
    />
  ) : (
    <StreamsScreen title={title} preview={preview} video={video} groups={state.groups} />
  );
}

/** The Streams level's furniture before there is a list: Back, and the subject. */
function StreamsWaiting({
  subject,
  onBack,
  children,
}: {
  subject: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="shell-streams"
      data-testid="streams-loading-level"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject}`}
      aria-label={`Streams — ${subject}`}
    >
      <header className="shell-streams-head">
        <Button variant="ghost" autoFocus onClick={onBack}>
          Back
        </Button>
        <h1 className="shell-streams-title">{`Streams — ${subject}`}</h1>
      </header>
      {children}
    </section>
  );
}

/**
 * The Streams a Video can be played as, pushed as a level over its Title.
 *
 * One block per Addon that answered, in the Host's order; an Addon that failed
 * or answered nothing says so in its own block without blanking the others. A
 * candidate is listed whether or not this Host can play it. Pressing one it can
 * play sends the whole candidate back with the Title card; pressing one it
 * cannot marks it here and asks the Host nothing.
 */
export function StreamsScreen({
  title,
  preview,
  video,
  groups,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  groups: AddonStreams[];
}) {
  const { pop } = useShell();
  const { chosen, opening, openingStream, choose } = useStreamChoice(
    title,
    preview,
    video,
  );
  // A film's Streams are the Title's, however its Video is spelled; a series'
  // are the episode's, by the number and name the source listed.
  const subject = isSeries(title) ? subjectOf(video) : nameOf(title, preview);

  return (
    <section
      className="shell-streams"
      data-testid="streams"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject}`}
      aria-label={`Streams — ${subject}`}
    >
      <header className="shell-streams-head">
        <Button variant="ghost" autoFocus onClick={pop}>
          Back
        </Button>
        <h1 className="shell-streams-title" data-testid="streams-heading">
          {`Streams — ${subject}`}
        </h1>
      </header>

      {groups.length === 0 ? (
        <p className="shell-streams-note" data-testid="streams-none">
          No configured Addon offers Streams for this Video.
        </p>
      ) : null}

      {groups.map((group) => (
        <section
          className="shell-stream-group"
          key={group.addon}
          data-testid={`streams-${group.addon}`}
          data-region={`streams:${group.addon}`}
          data-kind="row"
          data-label={group.addon}
        >
          <h2 className="shell-stream-addon">{group.addon}</h2>

          {group.failure ? (
            <p role="alert" className="shell-stream-failure">
              {explain(group.failure)}
            </p>
          ) : null}
          {!group.failure && group.streams.length === 0 ? (
            <p className="shell-streams-note">
              This Addon answered nothing this Host can play.
            </p>
          ) : null}

          <ul className="shell-stream-list">
            {group.streams.map((stream, index) => (
              <li key={index}>
                <Candidate
                  addon={group.addon}
                  index={index}
                  stream={stream}
                  chosen={chosen === stream}
                  opening={openingStream === stream}
                  disabled={opening}
                  onChoose={(stream) => void choose(group.addon, stream)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {chosen ? (
        <p role="status" className="shell-streams-chosen" data-testid="chosen-stream">
          {unplayableNote(chosen)}
        </p>
      ) : null}
    </section>
  );
}

/** What the Streams are Streams *of*: the episode by its number and name. */
function subjectOf(video: Video): string {
  const label = labelOf(video) ?? video.id;
  return [label, video.name].filter((part): part is string => Boolean(part)).join(" — ");
}

/**
 * One candidate: the Addon's own badge lines, the filename, its description,
 * the hints it carries, and why this Host cannot open it where that is so.
 */
function Candidate({
  addon,
  index,
  stream,
  chosen,
  opening,
  disabled,
  onChoose,
}: {
  addon: string;
  index: number;
  stream: Stream;
  chosen: boolean;
  opening: boolean;
  disabled: boolean;
  onChoose: (stream: Stream) => void;
}) {
  const badges = badgeLines(stream);
  const note = playabilityNote(stream.playback);

  return (
    <button
      type="button"
      className="shell-candidate kit-focus-lift"
      data-focusable
      data-testid={`candidate-${addon}-${index}`}
      aria-pressed={chosen}
      aria-busy={opening || undefined}
      disabled={disabled}
      onClick={() => onChoose(stream)}
    >
      {badges.length > 0 ? (
        <span className="shell-candidate-badges">
          {badges.map((badge, at) => (
            <Chip key={at} tone="accent">
              {badge}
            </Chip>
          ))}
        </span>
      ) : null}

      {stream.filename ? (
        <span className="shell-candidate-file" data-testid="stream-filename">
          {stream.filename}
        </span>
      ) : null}

      {stream.description ? (
        <span className="shell-candidate-description">{stream.description}</span>
      ) : null}

      {stream.warnings.length > 0 || note ? (
        <span className="shell-candidate-notes">
          {stream.warnings.map((warning) => (
            <Chip key={warning} tone="warn">
              {warningNote(warning)}
            </Chip>
          ))}
          {note ? <Chip tone="danger">{note}</Chip> : null}
        </span>
      ) : null}

      {opening ? (
        <span className="shell-candidate-opening" role="status">
          <PendingSpinner /> Opening…
        </span>
      ) : null}
    </button>
  );
}
