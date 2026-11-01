import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { actionKey } from "../core/actionKey";
import { DESTINATIONS } from "../core/destinations";
import { explain } from "../core/errors";
import type { ActionError } from "../core/errors";
import { isTypingTarget, keyIntent } from "../core/input";
import type { HostLink } from "../core/link";
import { useNavigation, type NavigationReads } from "../core/react/useNavigation";
import { useSession } from "../core/react/useSession";
import type { Session, SessionState } from "../core/session";
import type { DeviceSummary } from "../core/wire";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import { Home } from "./Home";
import { armSentinel, decideHistory } from "./history";
import { RemoteLevel, type RemotePayload } from "./levels";
import { RemoteDestination } from "./placeholders";

export type RemoteAppProps = {
  /**
   * The Host's one door. The entry point builds it — one socket per page, not
   * one per render — and a test hands in its own.
   */
  link: HostLink;
};

/**
 * The served Remote (ADR-0035 §1).
 *
 * A client of the Host and nothing more: it follows the link's state, asks for
 * the Snapshot a paired connection is owed, takes Actions through the one door,
 * and draws the six destinations it can reach. The pairing gate is the one
 * screen the window does not have; the room behind it is the same navigation
 * the window uses.
 */
export function RemoteApp({ link }: RemoteAppProps) {
  const subscribe = useCallback(
    (handler: () => void) => link.onState(handler),
    [link],
  );
  const read = useCallback(() => link.state(), [link]);
  const linkState = useSyncExternalStore(subscribe, read, read);
  const { session, state } = useSession(link);

  // Where the person is belongs to the app, not to the room that draws it: a
  // socket that drops and comes back is the same visit, so a phone that locked
  // lands on the destination it was reading rather than at Home (ADR-0035 §1).
  const nav = useNavigation<RemotePayload>();

  // Whether this page has ever been inside. A page whose first connection
  // failed is still on its way to the gate; one that was paired and dropped is
  // in the room it was in, with the state it holds.
  const [everPaired, setEverPaired] = useState(false);
  useEffect(() => {
    if (linkState.kind === "ready") {
      setEverPaired(true);
    }
  }, [linkState.kind]);

  switch (linkState.kind) {
    case "connecting":
      return <RemoteNotice title="Connecting" note="Waiting for the Host…" />;
    case "unpaired":
      return (
        <PairingGate
          session={session}
          sessionState={state}
          notice={linkState.notice}
        />
      );
    case "closed":
      return <RemoteNotice title="Not connected" note={linkState.reason} />;
    case "ready":
      return (
        <RemoteRoom
          session={session}
          nav={nav}
          sessionState={state}
          device={linkState.device}
          reconnecting={false}
        />
      );
    case "reconnecting":
      return everPaired ? (
        <RemoteRoom
          session={session}
          nav={nav}
          sessionState={state}
          device={null}
          reconnecting
        />
      ) : (
        <RemoteNotice title="Connecting" note="Waiting for the Host…" />
      );
  }
}

/**
 * The pairing gate: the one thing an unpaired connection may do.
 *
 * The form's Action is the Host's own `pair_device`, sent through the Session
 * like every other control, so the button draws the wait and a refusal is the
 * Host's words rather than the page's guess (ADR-0032).
 */
function PairingGate({
  session,
  sessionState,
  notice,
}: {
  session: Session;
  sessionState: SessionState;
  notice: string;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const action = {
    type: "pair_device",
    code: code.trim(),
    name: name.trim() || "Device",
  } as const;
  const waiting = sessionState.pending.has(actionKey(action));

  return (
    <form
      className="remote-pairing"
      onSubmit={(event) => {
        event.preventDefault();
        void session.take(action);
      }}
    >
      <h1 className="remote-pairing-title">Pair this device</h1>
      <p className="remote-pairing-note">{notice}</p>

      <Field
        id="remote-pairing-code"
        label="Pairing code"
        value={code}
        onChange={setCode}
        autoComplete="off"
      />
      <Field
        id="remote-pairing-name"
        label="Device name"
        value={name}
        onChange={setName}
        autoComplete="off"
      />

      <Button type="submit" variant="primary" pending={waiting}>
        Pair
      </Button>

      <RemoteRefusal error={sessionState.error} />
    </form>
  );
}

/**
 * The room behind the gate: six destinations, the level stack, the browser's
 * Back, and the connection's own news.
 *
 * B2 draws Home and the Title level a card pushes; the other five destinations
 * still draw the skeleton's placeholder. The navigation, the level stack's Back
 * and the history sentinel are the ones every later screen uses (ADR-0035 §1).
 */
function RemoteRoom({
  session,
  nav,
  sessionState,
  device,
  reconnecting,
}: {
  session: Session;
  nav: NavigationReads<RemotePayload>;
  sessionState: SessionState;
  device: DeviceSummary | null;
  reconnecting: boolean;
}) {
  // A page that is paired and navigates sits on its own sentinel entry, so the
  // phone's Back gesture is one more `back()` rather than a page left behind.
  useEffect(() => {
    armSentinel(window.history, true);
  }, [nav.state]);

  useEffect(() => {
    const onPop = () => {
      if (decideHistory(window.history.state, true, nav.canGoBack) === "back") {
        nav.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [nav]);

  // The Remote keeps Back on the keyboard too, through the one intent table the
  // window reads: Escape, Backspace and a television browser's GoBack are the
  // same Back, and Backspace is a deletion where a person is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const intent = keyIntent(event.key, isTypingTarget(event.target));
      if (intent === "back" && nav.canGoBack) {
        event.preventDefault();
        nav.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const refusal = sessionState.error;
  const level = nav.levels[nav.levels.length - 1] ?? null;

  return (
    <div className="remote-ui">
      <header className="remote-status">
        <span className="remote-device">{device ? device.name : "This device"}</span>
        {reconnecting ? (
          <span className="remote-connection">Reconnecting…</span>
        ) : (
          <span className="remote-connection" data-live="true">
            Live
          </span>
        )}
      </header>

      <main className="remote-main">
        {level ? (
          <RemoteLevel level={level} />
        ) : nav.destination === "home" ? (
          <Home
            session={session}
            state={sessionState}
            push={nav.push}
            choose={nav.choose}
          />
        ) : (
          <RemoteDestination destination={nav.destination} />
        )}
        <RemoteRefusal error={refusal} />
      </main>

      <nav className="remote-index" aria-label="Destinations">
        {DESTINATIONS.map((destination) => (
          <Button
            key={destination.id}
            variant="ghost"
            pressed={nav.destination === destination.id}
            onClick={() => nav.choose(destination.id)}
          >
            {destination.label}
          </Button>
        ))}
      </nav>
    </div>
  );
}

/** A page with nothing to draw but what it is waiting for. */
function RemoteNotice({ title, note }: { title: string; note: string }) {
  return (
    <div className="remote-notice">
      <h1 className="remote-notice-title">{title}</h1>
      <p className="remote-notice-note">{note}</p>
    </div>
  );
}

/**
 * The one refusal either surface can be shown: the Host's own words, through
 * the seam that chooses them, and never a softened empty state.
 */
function RemoteRefusal({ error }: { error: ActionError | null }) {
  if (!error) {
    return null;
  }
  return (
    <p className="remote-refusal" role="alert">
      {explain(error)}
    </p>
  );
}
