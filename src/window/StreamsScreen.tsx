import { useEffect, useState } from "react";

import type { AddonStreams, Title, Video } from "../core/wire";
import { explain, type ActionError } from "../core/errors";
import { answeredStreams } from "../core/answers";
import { streamsSubject } from "../core/stream";
import type { OpenablePreview } from "../core/title";
import { useShell } from "./context";
import { RepertoryStreamsScreen, RepertoryStreamsWaiting } from "./repertory/RepertoryStreams";

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
  onOpened,
}: {
  title: Title;
  preview?: OpenablePreview | null;
  video: Video;
  /**
   * The Host took the chosen Stream. A level that opened the list just for one
   * press puts itself away here; the Title's own flow leaves this out, so its
   * list stays where a person left it.
   */
  onOpened?: () => void;
}) {
  const { ask, pop, markUnplayable } = useShell();
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
    return (
      <RepertoryStreamsWaiting subject={subject} onBack={pop}>
        <p className="rep-streams-note" data-testid="streams-loading">
          Looking for Streams…
        </p>
      </RepertoryStreamsWaiting>
    );
  }

  if ("failure" in state) {
    return (
      <RepertoryStreamsWaiting subject={subject} onBack={pop}>
        <p role="alert" className="rep-stream-failure" data-testid="streams-failure">
          {explain(state.failure)}
        </p>
      </RepertoryStreamsWaiting>
    );
  }

  return (
    <RepertoryStreamsScreen
      title={title}
      preview={preview}
      video={video}
      groups={state.groups}
      onOpened={onOpened}
    />
  );
}

export { RepertoryStreamsScreen as StreamsScreen };
