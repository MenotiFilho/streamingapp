import type { ReactNode } from "react";

import { explain, type AddonStreams, type Stream, type Title, type Video } from "../../host-client";
import { badgeLines, playabilityNote, unplayableNote, warningNote } from "../../stream";
import type { OpenablePreview } from "../../title";
import { useShell } from "../context";
import { PendingSpinner } from "./kit";
import { useStreamChoice } from "../streamChoice";
import { programIndex } from "./program";
import { RowHead } from "./RowHead";
import { candidateCountLabel, streamsGroupName, streamsSubject } from "./streamsList";

/**
 * The Streams level as a technical screening list: one block per Addon that
 * answered, in the Host's order, each candidate numbered and read by its
 * Addon's own badge lines, its release note, its filename, the warnings it
 * carries, and whether this Host can open it.
 *
 * Nothing is hidden for being unplayable. The list is what exists, and the mark
 * says why a candidate stays in it (#27, ADR-0020). The behaviour is the one
 * the Velvet surface already had; only the drawing is repertory.
 */
export function RepertoryStreamsScreen({
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
  const { snapshot, pop } = useShell();
  const { chosen, opening, openingStream, choose } = useStreamChoice(title, preview, video);
  const subject = streamsSubject(title, preview, video);
  const count = groups.reduce((held, group) => held + group.streams.length, 0);

  return (
    <section
      className="rep-streams"
      data-testid="streams"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject}`}
      aria-label={`Streams — ${subject}`}
    >
      <header className="rep-streams-head">
        <button
          type="button"
          className="rep-button rep-streams-back"
          data-focusable
          autoFocus
          onClick={pop}
        >
          Back
        </button>
        <div className="rep-streams-heading">
          <p className="rep-streams-kicker">
            <span>A screening list</span>
            <span className="rep-rule" aria-hidden="true" />
            <span>{candidateCountLabel(count, groups.length)}</span>
          </p>
          <h1 className="rep-streams-title" data-testid="streams-heading">
            {subject}
          </h1>
        </div>
      </header>

      {groups.length === 0 ? (
        <p className="rep-streams-note" data-testid="streams-none">
          No configured Addon offers Streams for this Video.
        </p>
      ) : null}

      {groups.map((group, groupIndex) => {
        const name = streamsGroupName(snapshot, group.addon);
        return (
          <section
            className="rep-stream-group"
            key={group.addon}
            data-testid={`streams-${group.addon}`}
            data-region={`streams:${group.addon}`}
            data-kind="row"
            data-label={name}
          >
            <RowHead
              index={programIndex(groupIndex + 1)}
              title={name}
              tag={`${group.streams.length} ${
                group.streams.length === 1 ? "candidate" : "candidates"
              }`}
            />

            {group.failure ? (
              <p role="alert" className="rep-stream-failure">
                {explain(group.failure)}
              </p>
            ) : null}
            {!group.failure && group.streams.length === 0 ? (
              <p className="rep-streams-note">This Addon answered nothing this Host can play.</p>
            ) : null}

            <ol className="rep-stream-list">
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
            </ol>
          </section>
        );
      })}

      {chosen ? (
        <p role="status" className="rep-streams-chosen" data-testid="chosen-stream">
          {unplayableNote(chosen)}
        </p>
      ) : null}
    </section>
  );
}

/** The Streams level's furniture before there is a list: Back and the subject. */export function RepertoryStreamsWaiting({
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
      className="rep-streams rep-streams-waiting"
      data-testid="streams-loading-level"
      data-region="streams"
      data-kind="branch"
      data-label={`Streams — ${subject}`}
      aria-label={`Streams — ${subject}`}
    >
      <header className="rep-streams-head">
        <button
          type="button"
          className="rep-button rep-streams-back"
          data-focusable
          autoFocus
          onClick={onBack}
        >
          Back
        </button>
        <div className="rep-streams-heading">
          <p className="rep-streams-kicker">
            <span>A screening list</span>
            <span className="rep-rule" aria-hidden="true" />
            <span>Looking</span>
          </p>
          <h1 className="rep-streams-title">{subject}</h1>
        </div>
      </header>
      {children}
    </section>
  );
}

/** One candidate: numbered, with its Addon badges, release, filename and marks. */
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
  const unplayable = playabilityNote(stream.playback);

  return (
    <button
      type="button"
      className="rep-candidate"
      data-focusable
      data-testid={`candidate-${addon}-${index}`}
      data-unplayable={unplayable ? "true" : undefined}
      aria-pressed={chosen}
      aria-busy={opening || undefined}
      disabled={disabled}
      onClick={() => onChoose(stream)}
    >
      <span className="rep-candidate-index">{programIndex(index + 1)}</span>
      <span className="rep-candidate-body">
        {badges.length > 0 ? (
          <span className="rep-candidate-badges">
            {badges.map((badge, at) => (
              <span
                key={at}
                className="rep-badge"
                data-role={at === 0 ? "source" : "quality"}
              >
                {badge}
              </span>
            ))}
          </span>
        ) : null}

        {stream.description ? (
          <span className="rep-candidate-description">{stream.description}</span>
        ) : null}

        {stream.filename ? (
          <span className="rep-candidate-file" data-testid="stream-filename">
            {stream.filename}
          </span>
        ) : null}

        {stream.warnings.length > 0 || unplayable ? (
          <span className="rep-candidate-notes">
            {stream.warnings.map((warning) => (
              <span key={warning} className="rep-warning">
                {warningNote(warning)}
              </span>
            ))}
            {unplayable ? (
              <span className="rep-unplayable-note" data-testid="stream-unplayable">
                {unplayable}
              </span>
            ) : null}
          </span>
        ) : null}

        {opening ? (
          <span className="rep-candidate-opening" role="status">
            <PendingSpinner /> Opening…
          </span>
        ) : null}
      </span>
      <span className="rep-candidate-mark">{unplayable ? "Unplayable" : "Play"}</span>
    </button>
  );
}
