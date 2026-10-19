import { useCallback, useState } from "react";

import {
  explain,
  type AddonStreams,
  type Stream,
  type Title,
  type Video,
} from "../host-client";
import {
  badgeLines,
  playabilityNote,
  unplayableNote,
  warningNote,
} from "../stream";
import {
  isSeries,
  labelOf,
  nameOf,
  titleStubOf,
  type OpenablePreview,
} from "../title";
import { useShell } from "./context";
import { Button, Chip } from "./kit";
import "./streams.css";

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
  const { pop, take } = useShell();
  const [chosen, setChosen] = useState<Stream | null>(null);
  // A film's Streams are the Title's, however its Video is spelled; a series'
  // are the episode's, by the number and name the source listed.
  const subject = isSeries(title) ? subjectOf(video) : nameOf(title, preview);

  const choose = useCallback(
    async (addon: string, stream: Stream) => {
      if (playabilityNote(stream.playback) !== null) {
        setChosen(stream);
        return;
      }

      setChosen(null);
      await take({
        type: "play_stream",
        video: { type: title.type, id: video.id },
        addon,
        stream,
        title: titleStubOf(title, preview),
      });
    },
    [preview, take, title, video.id],
  );

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
        <Button variant="ghost" onClick={pop}>
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
  onChoose,
}: {
  addon: string;
  index: number;
  stream: Stream;
  chosen: boolean;
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
    </button>
  );
}
