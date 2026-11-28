import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { actionKey } from "../core/actionKey";
import type { Destination } from "../core/destinations";
import { explain, type ActionError } from "../core/errors";
import { isTypingTarget, keyIntent } from "../core/input";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { pageAttrs } from "../core/pageLayout";
import { watching } from "../core/playback";
import { useNavigation, type NavigationReads } from "../core/react/useNavigation";
import { useSession } from "../core/react/useSession";
import type { Session, SessionState } from "../core/session";
import type { DeviceSummary } from "../core/wire";
import { BrandMark } from "../kit/marquee/BrandMark";
import { CodeInput } from "../kit/marquee/phone/CodeInput";
import { TabBar } from "../kit/marquee/phone/TabBar";
import { PhoneButton } from "../kit/marquee/phone/controls";
import { Addons } from "./Addons";
import { Discover } from "./Discover";
import { Home } from "./Home";
import { Library } from "./Library";
import { PlayerStrip } from "./Player";
import { Search } from "./Search";
import { Settings } from "./Settings";
import { armSentinel, decideHistory } from "./history";
import { heldTitle, isSheetPayload, RemoteLevel, type RemotePayload } from "./levels";
import { pageSurface } from "./pageSurface";
import { failedOpen, playerLevelStale, stripDrawn } from "./playerScreen";
import { cardTitleOf, useMissingStreamPicker } from "./useMissingStreamPicker";

export type RemoteAppProps = {
  /**
   * The Host's one door. The entry point builds it — one socket per page, not
   * one per render — and a test hands in its own.
   */
  link: HostLink;
};

/**
 * The served Remote (ADR-0035 §1, Marquee design-system §11).
 */
export function RemoteApp({ link }: RemoteAppProps) {
  const subscribe = useCallback(
    (handler: () => void) => link.onState(handler),
    [link],
  );
  const read = useCallback(() => link.state(), [link]);
  const linkState = useSyncExternalStore(subscribe, read, read);
  const { session, state } = useSession(link);

  const nav = useNavigation<RemotePayload>();

  const [everPaired, setEverPaired] = useState(false);
  useEffect(() => {
    if (linkState.kind === "ready") {
      setEverPaired(true);
    }
  }, [linkState.kind]);

  return <div className="mq-root mq-remote-root">{renderLinkState()}</div>;

  function renderLinkState() {
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
}

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
  const host =
    typeof window !== "undefined" && window.location.host
      ? window.location.host
      : "this Host";

  const action = {
    type: "pair_device",
    code: code.trim(),
    name: "Phone",
  } as const;
  const waiting = sessionState.pending.has(actionKey(action));

  return (
    <form
      className="mq-remote-pairing"
      onSubmit={(event) => {
        event.preventDefault();
        void session.take(action);
      }}
    >
      <div className="mq-remote-pairing-head">
        <BrandMark />
        <h1 className="mq-remote-pairing-title">Pair with your Host</h1>
        <p className="mq-remote-pairing-note">{notice}</p>
      </div>

      <div className="mq-remote-pairing-body">
        <CodeInput
          label="Pairing code"
          value={code}
          onChange={setCode}
          autoFocus
          disabled={waiting}
        />

        <p className="mq-remote-pairing-host" data-testid="pairing-host">
          Host {host}
        </p>

        <PhoneButton
          type="submit"
          kind="primary"
          className="mq-remote-pairing-submit"
          disabled={waiting}
        >
          {waiting ? "Pairing…" : "Pair"}
        </PhoneButton>
      </div>

      <RemoteRefusal error={sessionState.error} />

      <p className="mq-remote-pairing-footnote">
        Single-use code from Settings → Remote devices on your Host.
      </p>
    </form>
  );
}

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
  const failed = failedOpen(sessionState.snapshot?.playback ?? null) !== null;
  const drawn = nav.levels.filter(
    (held) => !playerLevelStale(held.payload, playback, failed),
  );
  const level = drawn[drawn.length - 1] ?? null;

  useMissingStreamPicker({
    session,
    state: sessionState,
    levelKind: level?.payload.kind ?? null,
    cardTitle: cardTitleOf(level),
    push: nav.push,
  });

  const sheetOpen = level ? isSheetPayload(level.payload) : false;
  const under = sheetOpen ? (drawn[drawn.length - 2] ?? null) : null;
  const showDestination = level === null || (sheetOpen && under === null);
  const isPlayerTop =
    level?.payload.kind === "player" || level?.payload.kind === "sheet";
  const showTabBar = !isPlayerTop;
  const shownLevels = drawn.filter((held) => held === level || held === under);

  const surface = pageSurface(nav.destination, level?.payload.kind ?? null);

  const watchingIds = useRef(new Set<string>());
  useEffect(() => {
    const live = watching(playback);
    for (const held of nav.levels) {
      if ((live || failed) && held.payload.kind === "player") {
        watchingIds.current.add(held.id);
      }
    }
    const stale = nav.levels.find(
      (held) =>
        playerLevelStale(held.payload, playback, failed) &&
        watchingIds.current.has(held.id),
    );
    if (stale) {
      nav.removeFrom(stale.id);
    }
  }, [nav, playback, failed]);

  return (
    <div className="mq-remote-room" {...pageAttrs(surface)}>
      <div className="mq-remote-viewport">
        {reconnecting ? (
          <div className="mq-remote-reconnecting" role="status">
            <span>{device ? device.name : "Remote"}</span>
            <span>Reconnecting…</span>
          </div>
        ) : null}

        <main className="mq-remote-screen">
          {showDestination ? (
            <div inert={sheetOpen || undefined} aria-hidden={sheetOpen || undefined}>
              <RemoteDestination
                destination={nav.destination}
                session={session}
                state={sessionState}
                deviceId={device?.id ?? null}
                choose={nav.choose}
                push={nav.push}
              />
            </div>
          ) : null}

          {shownLevels.map((held) => {
            const isUnder = held !== level;
            return (
              <div
                key={held.id}
                inert={isUnder || undefined}
                aria-hidden={isUnder || undefined}
              >
                <RemoteLevel
                  level={held}
                  session={session}
                  state={sessionState}
                  deviceId={device?.id ?? null}
                  push={nav.push}
                  pop={nav.pop}
                />
              </div>
            );
          })}

          <RemoteRefusal error={refusal} />
        </main>
      </div>

      <div
        className="mq-remote-dock"
        inert={sheetOpen || undefined}
        aria-hidden={sheetOpen || undefined}
      >
        {stripDrawn(drawn) ? (
          <PlayerStrip
            session={session}
            title={heldTitle(drawn)}
            push={nav.push}
          />
        ) : null}

        {showTabBar ? (
          <TabBar active={nav.destination} onSelect={nav.choose} />
        ) : null}
      </div>
    </div>
  );
}

function RemoteDestination({
  destination,
  session,
  state,
  deviceId,
  choose,
  push,
}: {
  destination: Destination;
  session: Session;
  state: SessionState;
  deviceId: string | null;
  choose: (destination: Destination) => void;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  switch (destination) {
    case "home":
      return <Home session={session} state={state} push={push} choose={choose} />;
    case "discover":
      return (
        <Discover
          session={session}
          state={state}
          push={push}
          openSettings={() => choose("settings")}
        />
      );
    case "search":
      return <Search session={session} state={state} push={push} />;
    case "library":
      return <Library session={session} state={state} push={push} />;
    case "addons":
      return <Addons session={session} state={state} push={push} />;
    case "settings":
      return (
        <Settings
          session={session}
          state={state}
          deviceId={deviceId}
          push={push}
        />
      );
  }
}

function RemoteNotice({ title, note }: { title: string; note: string }) {
  return (
    <main className="mq-remote-waiting">
      <BrandMark />
      <h1 className="mq-remote-waiting-title">{title}</h1>
      <p className="mq-remote-waiting-note">{note}</p>
    </main>
  );
}

function RemoteRefusal({ error }: { error: ActionError | null }) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="mq-remote-refusal">
      {explain(error)}
    </p>
  );
}
