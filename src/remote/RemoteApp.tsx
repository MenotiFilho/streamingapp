import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { actionKey } from "../core/actionKey";
import { DESTINATIONS } from "../core/destinations";
import { explain } from "../core/errors";
import type { ActionError } from "../core/errors";
import { isTypingTarget, keyIntent } from "../core/input";
import type { HostLink } from "../core/link";
import { pageAttrs } from "../core/pageLayout";
import { watching } from "../core/playback";
import { useNavigation, type NavigationReads } from "../core/react/useNavigation";
import { useSession } from "../core/react/useSession";
import type { Session, SessionState } from "../core/session";
import type { DeviceSummary } from "../core/wire";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import { Addons } from "./Addons";
import { Discover } from "./Discover";
import { Home } from "./Home";
import { Library } from "./Library";
import { Search } from "./Search";
import { armSentinel, decideHistory } from "./history";
import { heldTitle, isSheetPayload, RemoteLevel, type RemotePayload } from "./levels";
import { pageSurface } from "./pageSurface";
import { PlayerStrip } from "./Player";
import { playerLevelStale, stripDrawn } from "./playerScreen";
import { Settings } from "./Settings";
import { cardTitleOf, useMissingStreamPicker } from "./useMissingStreamPicker";

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
 * Every destination has its own screen — Home (B2), Discover and Search (B3),
 * the account Library (B4), the Addons form and register (B5), Settings and its
 * four leaves (B7) — and the Title and Streams levels are B6's. The navigation,
 * the level stack's Back and the history sentinel are the ones every screen
 * uses (ADR-0035 §1).
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
  const playback = sessionState.snapshot?.playback?.state ?? "idle";
  // A card of a Stream the Host has stopped is no card, and a card the Host has
  // not yet confirmed is not drawn yet either: what is on screen is the top
  // level that is not such a card — the Title it was opened over, say — and the
  // destination only when there is none.
  const drawn = nav.levels.filter(
    (held) => !playerLevelStale(held.payload, playback),
  );
  const level = drawn[drawn.length - 1] ?? null;
  // A sheet is furniture above the card, not a screen of its own: the level
  // under it stays drawn so Back puts the plate away and the card is still
  // there. While it is open the card and the dock are inert, which is what
  // makes the modal panel the one region a press or a tab can reach.
  useMissingStreamPicker({
    session,
    state: sessionState,
    levelKind: level?.payload.kind ?? null,
    cardTitle: cardTitleOf(level),
    push: nav.push,
  });
  const sheetOpen = level ? isSheetPayload(level.payload) : false;
  const under = sheetOpen ? (drawn[drawn.length - 2] ?? null) : null;

  // The page rule (ADR-0036 §3): Discover, Search, the Title and the player card
  // fit the phone's viewport; Home and the utility register keep a scrolling
  // page. The frame and the screen root read this one decision.
  const surface = pageSurface(nav.destination, level?.payload.kind ?? null);

  // The Snapshot is the truth: when it says the Stream is gone, the player and
  // every plate above it leave the stack, whatever closed it — Stop, the
  // Host's own end, or another client's Stop.
  //
  // "Gone" means gone: a card is opened the moment the Host takes the Stream,
  // and the Snapshot that says it is playing is the next frame — so a card that
  // has not yet been drawn over a playing Stream is still on its way, not
  // stale. The ids that have been watching are the ones a stop may take away.
  const watchingIds = useRef(new Set<string>());
  useEffect(() => {
    const live = watching(playback);
    for (const held of nav.levels) {
      if (live && held.payload.kind === "player") {
        watchingIds.current.add(held.id);
      }
    }
    const stale = nav.levels.find(
      (held) =>
        playerLevelStale(held.payload, playback) &&
        watchingIds.current.has(held.id),
    );
    if (stale) {
      nav.removeFrom(stale.id);
    }
  }, [nav, playback]);

  return (
    <div
      className="remote-ui"
      {...pageAttrs(surface)}
    >
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
        {under ? (
          <div inert aria-hidden="true">
            <RemoteLevel
              level={under}
              session={session}
              state={sessionState}
              push={nav.push}
              pop={nav.pop}
            />
          </div>
        ) : null}
        {level ? (
          <RemoteLevel
            level={level}
            session={session}
            state={sessionState}
            push={nav.push}
            pop={nav.pop}
          />
        ) : nav.destination === "home" ? (
          <Home
            session={session}
            state={sessionState}
            push={nav.push}
            choose={nav.choose}
          />
        ) : nav.destination === "discover" ? (
          <Discover session={session} state={sessionState} push={nav.push} />
        ) : nav.destination === "search" ? (
          <Search session={session} state={sessionState} push={nav.push} />
        ) : nav.destination === "library" ? (
          <Library
            session={session}
            state={sessionState}
            push={nav.push}
            choose={nav.choose}
          />
        ) : nav.destination === "addons" ? (
          <Addons session={session} state={sessionState} push={nav.push} />
        ) : nav.destination === "settings" ? (
          <Settings push={nav.push} />
        ) : null}
        <RemoteRefusal error={refusal} />
      </main>

      <div
        className="remote-dock"
        inert={sheetOpen ? true : undefined}
        aria-hidden={sheetOpen ? true : undefined}
      >
        {stripDrawn(drawn) ? (
          <PlayerStrip
            session={session}
            title={heldTitle(nav.levels)}
            push={nav.push}
          />
        ) : null}

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
