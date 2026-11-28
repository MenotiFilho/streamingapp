import { useEffect, useState, type FormEvent } from "react";

import { version as packageVersion } from "../../package.json";
import tmdbLogo from "../assets/tmdb-logo.svg";
import {
  AUTOPLAY_SWITCH_LABEL,
  STREAM_BUFFER_DEFAULT_MEGABYTES,
  STREAM_BUFFER_DEFAULT_SECONDS,
  STREAM_BUFFER_MEGABYTES,
  STREAM_BUFFER_SECONDS,
  SUBTITLE_COLORS,
  TORRENT_CACHE_DEFAULT_MEGABYTES,
  TORRENT_CACHE_HEAD,
  TORRENT_CACHE_MEGABYTES,
  TORRENT_FETCH_NOTE,
  UP_NEXT_PLAYBACK_CHOICES,
  autoplayOn,
  bufferMegabytesPreset,
  bufferSecondsPreset,
  colorSelected,
  formatBufferMegabytes,
  formatBufferSeconds,
  formatTorrentCache,
  torrentCachePreset,
  torrentCacheRequest,
} from "../core/controls";
import { explain, type ActionError } from "../core/errors";
import { down, rows, tick, untick, up, type LanguageKind } from "../core/languageList";
import {
  FOLLOW_THE_FILE,
  FOLLOW_THE_FILE_AUDIO_LINE,
  FOLLOW_THE_FILE_SUBTITLE_LINE,
} from "../core/languages";
import {
  PREFERENCE_SUB_LEVELS,
  activeFeaturedKey,
  clampPreviewScale,
  featuredCatalogAction,
  featuredCatalogChoices,
  formatPairedDetail,
  preferenceListEntries,
  type PreferenceSubLevelId,
} from "../core/marqueeSettings";
import type { NewLevel } from "../core/navigation";
import { useLanguageList } from "../core/react/useLanguageList";
import type { Session, SessionState } from "../core/session";
import {
  LICENCE,
  NO_CATALOG,
  SETTINGS_CATEGORIES,
  TMDB_NOTICE,
  protectionLedger,
  settingsLevelId,
  unknownColorLabel,
  type SettingsCategoryId,
} from "../core/settingsRegister";
import type { Action } from "../core/wire";
import { Chip } from "../kit/marquee/Chip";
import { EmptyState } from "../kit/marquee/EmptyState";
import { GroupLabel } from "../kit/marquee/GroupLabel";
import { PairingCode } from "../kit/marquee/PairingCode";
import { RankedRow } from "../kit/marquee/RankedRow";
import { SizeStepper } from "../kit/marquee/SizeStepper";
import { TextField } from "../kit/marquee/TextField";
import type { IconName } from "../kit/marquee/icons";
import { PhoneHeader } from "../kit/marquee/phone/PhoneHeader";
import { PhoneListRow } from "../kit/marquee/phone/PhoneListRow";
import { PhoneSwitchRow } from "../kit/marquee/phone/PhoneSwitchRow";
import { PhoneButton, PhoneIconButton } from "../kit/marquee/phone/controls";
import type { RemotePayload } from "./levels";
import {
  SETTINGS_WAITING,
  STREMIO_EMAIL_LABEL,
  STREMIO_EMAIL_PLACEHOLDER,
  STREMIO_PASSWORD_LABEL,
  STREMIO_PASSWORD_PLACEHOLDER,
  STREMIO_SIGN_IN,
  STREMIO_SIGN_OUT,
  TMDB_CLEAR,
  TMDB_FIELD_LABEL,
  TMDB_FIELD_PLACEHOLDER,
  TMDB_SAVE,
  clearTmdbLevel,
  revokeLevel,
  settingsCategoryOf,
  settingsLevel,
  signInRequest,
  signOutLevel,
  tmdbKeyRequest,
} from "./settingsScreen";

export type SettingsProps = {
  session: Session;
  state: SessionState;
  deviceId: string | null;
  push: (level: NewLevel<RemotePayload>) => string;
};

function categoryIcon(id: SettingsCategoryId): IconName {
  switch (id) {
    case "credentials":
      return "key";
    case "preferences":
      return "sliders-horizontal";
    case "remote-devices":
      return "device";
    case "about":
      return "info";
  }
}

export function Settings({ state, push }: SettingsProps) {
  const snapshot = state.snapshot;
  const ledger = snapshot ? protectionLedger(snapshot.protection) : null;
  const pairedCount = snapshot?.devices.length ?? 0;

  const valueFor = (id: SettingsCategoryId): string => {
    switch (id) {
      case "credentials":
        return ledger?.backend ?? "";
      case "preferences":
        return autoplayOn(snapshot) ? "Autoplay on" : "Autoplay off";
      case "remote-devices":
        return `${pairedCount} paired`;
      case "about":
        return `v${packageVersion}`;
    }
  };

  return (
    <section
      className="mq-remote-screen"
      aria-label="Settings"
      data-testid="remote-settings"
    >
      <header className="mq-remote-large-head">
        <div className="mq-remote-large-head-titles">
          <h1 className="mq-remote-large-title">Settings</h1>
        </div>
      </header>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          {SETTINGS_WAITING}
        </p>
      ) : (
        <div className="mq-remote-body">
          <div className="mq-remote-list-card">
            {SETTINGS_CATEGORIES.map((category) => (
              <div key={category.id} data-testid={`settings-category-${category.id}`}>
                <PhoneListRow
                  kind="value"
                  icon={categoryIcon(category.id)}
                  label={category.title}
                  value={valueFor(category.id)}
                  onPress={() => push(settingsLevel(category))}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsLeaf({
  category,
  session,
  state,
  deviceId,
  push,
  pop,
}: {
  category: SettingsCategoryId;
  session: Session;
  state: SessionState;
  deviceId: string | null;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
}) {
  const meta = settingsCategoryOf(category);

  return (
    <section
      className="mq-remote-screen"
      aria-label={meta.title}
      data-testid={settingsLevelId(meta)}
    >
      <PhoneHeader title={meta.title} subtitle="Settings" onBack={pop} />

      {state.snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          {SETTINGS_WAITING}
        </p>
      ) : category === "credentials" ? (
        <CredentialsLeaf session={session} state={state} push={push} />
      ) : category === "preferences" ? (
        <PreferencesLeaf session={session} state={state} push={push} />
      ) : category === "remote-devices" ? (
        <DevicesLeaf state={state} deviceId={deviceId} push={push} />
      ) : (
        <AboutLeaf />
      )}
    </section>
  );
}

function CredentialsLeaf({
  session,
  state,
  push,
}: {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot!;
  const ledger = protectionLedger(snapshot.protection);

  const [tmdbDraft, setTmdbDraft] = useState("");
  const [tmdbError, setTmdbError] = useState<ActionError | null>(null);
  const [tmdbBusy, setTmdbBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stremioError, setStremioError] = useState<ActionError | null>(null);
  const [stremioBusy, setStremioBusy] = useState(false);

  const saveTmdb = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = tmdbKeyRequest(tmdbDraft);
    if (!action || tmdbBusy) {
      return;
    }
    setTmdbError(null);
    setTmdbBusy(true);
    const outcome = await session.ask(action);
    setTmdbBusy(false);
    if (outcome.error) {
      setTmdbError(outcome.error);
      return;
    }
    setTmdbDraft("");
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = signInRequest(email, password);
    if (!action || stremioBusy) {
      return;
    }
    setStremioError(null);
    setStremioBusy(true);
    const outcome = await session.ask(action);
    setStremioBusy(false);
    if (outcome.error) {
      setStremioError(outcome.error);
      return;
    }
    setEmail("");
    setPassword("");
  };

  return (
    <div className="mq-remote-body">
      <GroupLabel>Host ledger</GroupLabel>
      <div className="mq-remote-facts-card" data-testid="credentials-ledger">
        <div className="mq-remote-fact-row">
          <span className="mq-remote-fact-label">Secret store</span>
          <span className="mq-remote-fact-value">{ledger.backend}</span>
        </div>
        <div className="mq-remote-fact-row">
          <span className="mq-remote-fact-label">TMDB key</span>
          <span className="mq-remote-fact-value">{ledger.tmdb}</span>
        </div>
        <div className="mq-remote-fact-row">
          <span className="mq-remote-fact-label">Stremio account</span>
          <span className="mq-remote-fact-value">{ledger.stremio}</span>
        </div>
      </div>

      <GroupLabel>TMDB</GroupLabel>
      <form className="mq-remote-settings-group" onSubmit={saveTmdb}>
        <TextField
          label={TMDB_FIELD_LABEL}
          placeholder={TMDB_FIELD_PLACEHOLDER}
          masked
          value={tmdbDraft}
          onChange={setTmdbDraft}
          error={tmdbError ? explain(tmdbError) : null}
          disabled={tmdbBusy}
        />
        <div className="mq-remote-action-row">
          <PhoneButton type="submit" kind="primary" disabled={tmdbBusy}>
            {tmdbBusy ? "Saving…" : TMDB_SAVE}
          </PhoneButton>
          {snapshot.protection.tmdbHeld ? (
            <PhoneButton
              kind="secondary"
              disabled={tmdbBusy}
              onClick={() => push(clearTmdbLevel())}
            >
              {TMDB_CLEAR}
            </PhoneButton>
          ) : null}
        </div>
      </form>

      <GroupLabel>Stremio account</GroupLabel>
      {snapshot.protection.stremioHeld ? (
        <div className="mq-remote-addon-card">
          <p className="mq-remote-large-subtitle">
            Signed in on this Host. Signing out removes the stored token and leaves watch
            progress untouched.
          </p>
          <PhoneButton kind="danger" onClick={() => push(signOutLevel())}>
            {STREMIO_SIGN_OUT}
          </PhoneButton>
        </div>
      ) : (
        <form className="mq-remote-settings-group" onSubmit={signIn}>
          <TextField
            label={STREMIO_EMAIL_LABEL}
            type="email"
            autoComplete="email"
            placeholder={STREMIO_EMAIL_PLACEHOLDER}
            value={email}
            onChange={setEmail}
            disabled={stremioBusy}
          />
          <TextField
            label={STREMIO_PASSWORD_LABEL}
            type="password"
            autoComplete="current-password"
            placeholder={STREMIO_PASSWORD_PLACEHOLDER}
            value={password}
            onChange={setPassword}
            disabled={stremioBusy}
          />
          {stremioError ? (
            <p role="alert" className="mq-remote-inline-error">
              {explain(stremioError)}
            </p>
          ) : null}
          <PhoneButton type="submit" kind="primary" disabled={stremioBusy}>
            {stremioBusy ? "Signing in…" : STREMIO_SIGN_IN}
          </PhoneButton>
        </form>
      )}
    </div>
  );
}

function PreferencesLeaf({
  session,
  state,
  push,
}: {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot!;
  const entries = preferenceListEntries(snapshot);
  const [autoplayBusy, setAutoplayBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  const toggleAutoplay = async (autoplay: boolean) => {
    setError(null);
    setAutoplayBusy(true);
    const outcome = await session.ask({ type: "set_autoplay", autoplay });
    setAutoplayBusy(false);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  return (
    <div className="mq-remote-body" data-testid="preferences-list">
      <div className="mq-remote-list-card">
        {entries.map((entry) =>
          entry.kind === "switch" ? (
            <div key={entry.id} data-testid={`pref-row-${entry.id}`}>
              <PhoneListRow
                kind="switch"
                icon={entry.icon}
                label={entry.label}
                checked={entry.checked}
                disabled={autoplayBusy}
                onChange={(next) => void toggleAutoplay(next)}
              />
            </div>
          ) : (
            <div key={entry.id} data-testid={`pref-row-${entry.id}`}>
              <PhoneListRow
                kind="value"
                icon={entry.icon}
                label={entry.label}
                value={entry.value}
                onPress={() =>
                  push({
                    name: PREFERENCE_SUB_LEVELS[entry.subLevel].title,
                    kind: "overlay",
                    payload: { kind: "settings-pref", subLevel: entry.subLevel },
                  })
                }
              />
            </div>
          ),
        )}
      </div>

      {error ? (
        <p role="alert" className="mq-remote-inline-error">
          {explain(error)}
        </p>
      ) : null}
    </div>
  );
}

function DevicesLeaf({
  state,
  deviceId,
  push,
}: {
  state: SessionState;
  deviceId: string | null;
  push: (level: NewLevel<RemotePayload>) => string;
}) {
  const snapshot = state.snapshot!;
  const devices = snapshot.devices;

  return (
    <div className="mq-remote-body">
      <GroupLabel>Pair another device</GroupLabel>
      <PairingCode code={snapshot.pairingCode} address={snapshot.address} />

      <GroupLabel>Paired devices</GroupLabel>
      {devices.length === 0 ? (
        <EmptyState
          icon="device"
          title="No paired devices"
          body="Enter the code above on a phone or tablet on the same network."
        />
      ) : (
        <div className="mq-remote-list-card" data-testid="paired-devices-list">
          {devices.map((summary) => {
            const isCurrent = deviceId !== null && summary.id === deviceId;
            const detail = formatPairedDetail(summary.pairedAt);
            return (
              <div
                key={summary.id}
                className="mq-remote-device-row"
                data-testid={`device-${summary.id}`}
              >
                <div className="mq-remote-device-info">
                  <span className="mq-remote-device-name">{summary.name}</span>
                  <span
                    className="mq-remote-device-detail"
                    data-current={isCurrent ? "true" : undefined}
                  >
                    {isCurrent ? `This device · ${detail}` : detail}
                  </span>
                </div>
                <PhoneIconButton
                  icon="trash"
                  label={`Revoke ${summary.name}`}
                  kind="ghost"
                  onClick={() => push(revokeLevel(summary))}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AboutLeaf() {
  return (
    <div className="mq-remote-body" data-testid="about-leaf">
      <div className="mq-remote-about-tmdb">
        <img
          src={tmdbLogo}
          alt="The Movie Database (TMDB)"
          className="mq-remote-tmdb-logo"
        />
        <p className="mq-remote-about-copy">{TMDB_NOTICE}</p>
      </div>

      <div className="mq-remote-facts-card">
        <div className="mq-remote-fact-row" data-testid="about-version">
          <span className="mq-remote-fact-label">Version</span>
          <span className="mq-remote-fact-value">{packageVersion}</span>
        </div>
      </div>

      <GroupLabel>Licence</GroupLabel>
      <p className="mq-remote-about-copy">{LICENCE}</p>
    </div>
  );
}

export function PreferenceSubLevel({
  subLevel,
  session,
  state,
  pop,
}: {
  subLevel: PreferenceSubLevelId;
  session: Session;
  state: SessionState;
  pop: () => void;
}) {
  switch (subLevel) {
    case "subtitle-languages":
      return (
        <LanguagesSubLevel
          kind="subtitle"
          session={session}
          state={state}
          pop={pop}
        />
      );
    case "audio-languages":
      return (
        <LanguagesSubLevel
          kind="audio"
          session={session}
          state={state}
          pop={pop}
        />
      );
    case "subtitle-appearance":
      return <SubtitleAppearanceSubLevel session={session} state={state} pop={pop} />;
    case "stream-buffer":
      return <StreamBufferSubLevel session={session} state={state} pop={pop} />;
    case "up-next":
      return <UpNextSubLevel session={session} state={state} pop={pop} />;
  }
}

function LanguagesSubLevel({
  kind,
  session,
  state,
  pop,
}: {
  kind: LanguageKind;
  session: Session;
  state: SessionState;
  pop: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const meta =
    PREFERENCE_SUB_LEVELS[
      kind === "subtitle" ? "subtitle-languages" : "audio-languages"
    ];
  const { list, error, change, current } = useLanguageList(
    kind,
    state.snapshot,
    (action) => session.ask(action),
  );
  const view = rows(list);
  const followDetail =
    kind === "subtitle" ? FOLLOW_THE_FILE_SUBTITLE_LINE : FOLLOW_THE_FILE_AUDIO_LINE;

  if (choosing) {
    return (
      <section
        className="mq-remote-screen"
        aria-label="Choose language"
        data-testid={`language-picker-${kind}`}
      >
        <PhoneHeader
          title="Choose language"
          subtitle={meta.title}
          onBack={() => setChoosing(false)}
        />
        <div className="mq-remote-body">
          <div className="mq-remote-list-card">
            {view.rest.map((row) => (
              <PhoneListRow
                key={row.tag}
                kind="action"
                icon="plus"
                label={row.name}
                disabled={row.disabled}
                onPress={() => {
                  void change(tick(current(), row.tag));
                  setChoosing(false);
                }}
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mq-remote-screen"
      aria-label={meta.title}
      data-testid={`settings-sublevel-${kind}-languages`}
    >
      <PhoneHeader title={meta.title} subtitle={meta.crumb} onBack={pop} />

      <div className="mq-remote-body">
        <p className="mq-remote-large-subtitle">{meta.intro}</p>

        {view.chosen.length === 0 ? (
          <div className="mq-remote-follow-card" data-testid={`language-follow-${kind}`}>
            <p className="mq-remote-follow-title">{FOLLOW_THE_FILE}</p>
            <p className="mq-remote-follow-body">{followDetail}</p>
          </div>
        ) : (
          <div className="mq-remote-settings-group" data-testid={`language-chosen-${kind}`}>
            <GroupLabel>Priority order</GroupLabel>
            <div className="mq-remote-list-card">
              {view.chosen.map((row) => (
                <RankedRow
                  key={row.tag}
                  position={row.index + 1}
                  count={view.chosen.length}
                  label={row.name}
                  onMoveUp={() => void change(up(current(), row.index))}
                  onMoveDown={() => void change(down(current(), row.index))}
                  onRemove={() => void change(untick(current(), row.tag))}
                />
              ))}
            </div>
          </div>
        )}

        {view.note ? (
          <p className="mq-remote-large-subtitle" data-testid="language-note">
            {view.note}
          </p>
        ) : null}

        <PhoneListRow
          kind="action"
          icon="plus"
          label="Add language"
          disabled={view.chosen.length >= 3 || view.rest.every((item) => item.disabled)}
          onPress={() => setChoosing(true)}
        />

        {error ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SubtitleAppearanceSubLevel({
  session,
  state,
  pop,
}: {
  session: Session;
  state: SessionState;
  pop: () => void;
}) {
  const meta = PREFERENCE_SUB_LEVELS["subtitle-appearance"];
  const heldColor = state.snapshot?.preferences.subtitleColor ?? "#FFFFFF";
  const heldScale = state.snapshot?.preferences.subtitleScale ?? 1;
  const [error, setError] = useState<ActionError | null>(null);
  const otherColor = unknownColorLabel(heldColor);
  const previewScale = clampPreviewScale(heldScale);

  const pick = async (action: Action) => {
    setError(null);
    const outcome = await session.ask(action);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  return (
    <section
      className="mq-remote-screen"
      aria-label={meta.title}
      data-testid="settings-sublevel-subtitle-appearance"
    >
      <PhoneHeader title={meta.title} subtitle={meta.crumb} onBack={pop} />

      <div className="mq-remote-body">
        <div className="mq-remote-preview-frame" aria-hidden="true">
          <p
            className="mq-remote-preview-sample"
            style={{
              color: heldColor,
              fontSize: `${Math.round(16 * previewScale)}px`,
            }}
          >
            I always thought the sky was wider than this.
          </p>
        </div>

        <GroupLabel>Colour</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="subtitle-color-chips">
          {SUBTITLE_COLORS.map((choice) => (
            <Chip
              key={choice.color}
              selected={colorSelected(heldColor, choice.color)}
              onClick={() => void pick({ type: "set_subtitle_color", color: choice.color })}
            >
              {choice.label}
            </Chip>
          ))}
          {otherColor ? <Chip selected>{otherColor}</Chip> : null}
        </div>

        <GroupLabel>Size</GroupLabel>
        <div data-testid="subtitle-size-stepper">
          <SizeStepper
            scale={heldScale}
            onChange={(scale) => void pick({ type: "set_subtitle_scale", scale })}
          />
        </div>
        <p className="mq-remote-large-subtitle">From 25% to 300%, in steps of 5%.</p>

        {error ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function StreamBufferSubLevel({
  session,
  state,
  pop,
}: {
  session: Session;
  state: SessionState;
  pop: () => void;
}) {
  const meta = PREFERENCE_SUB_LEVELS["stream-buffer"];
  const publishedBuffer = state.snapshot?.preferences.streamBuffer ?? {
    seconds: STREAM_BUFFER_DEFAULT_SECONDS,
    megabytes: STREAM_BUFFER_DEFAULT_MEGABYTES,
  };
  const [bufferDraft, setBufferDraft] = useState(publishedBuffer);

  useEffect(() => {
    setBufferDraft(publishedBuffer);
  }, [publishedBuffer.seconds, publishedBuffer.megabytes]);

  const [bufferError, setBufferError] = useState<ActionError | null>(null);
  const [torrentError, setTorrentError] = useState<ActionError | null>(null);
  const heldTorrentCache =
    state.snapshot?.preferences.torrentCache.megabytes ?? TORRENT_CACHE_DEFAULT_MEGABYTES;

  const pickBuffer = async (seconds: number, megabytes: number) => {
    setBufferError(null);
    const next = { seconds, megabytes };
    setBufferDraft(next);
    const outcome = await session.ask({ type: "set_stream_buffer", ...next });
    if (outcome.error) {
      setBufferError(outcome.error);
      setBufferDraft(publishedBuffer);
    }
  };

  const pickTorrentCache = async (megabytes: number) => {
    setTorrentError(null);
    const outcome = await session.ask(torrentCacheRequest(megabytes));
    if (outcome.error) {
      setTorrentError(outcome.error);
    }
  };

  return (
    <section
      className="mq-remote-screen"
      aria-label={meta.title}
      data-testid="settings-sublevel-stream-buffer"
    >
      <PhoneHeader title={meta.title} subtitle={meta.crumb} onBack={pop} />

      <div className="mq-remote-body">
        <p className="mq-remote-large-subtitle">{meta.intro}</p>

        <GroupLabel>Look-ahead</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="buffer-seconds-chips">
          {STREAM_BUFFER_SECONDS.map((choice) => (
            <Chip
              key={choice.seconds}
              selected={bufferDraft.seconds === choice.seconds}
              onClick={() => void pickBuffer(choice.seconds, bufferDraft.megabytes)}
            >
              {choice.label}
            </Chip>
          ))}
          {!bufferSecondsPreset(bufferDraft.seconds) ? (
            <Chip selected>{formatBufferSeconds(bufferDraft.seconds)}</Chip>
          ) : null}
        </div>

        <GroupLabel>Memory ceiling</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="buffer-megabytes-chips">
          {STREAM_BUFFER_MEGABYTES.map((choice) => (
            <Chip
              key={choice.megabytes}
              selected={bufferDraft.megabytes === choice.megabytes}
              onClick={() => void pickBuffer(bufferDraft.seconds, choice.megabytes)}
            >
              {choice.label}
            </Chip>
          ))}
          {!bufferMegabytesPreset(bufferDraft.megabytes) ? (
            <Chip selected>{formatBufferMegabytes(bufferDraft.megabytes)}</Chip>
          ) : null}
        </div>

        {bufferError ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(bufferError)}
          </p>
        ) : null}

        <GroupLabel>{TORRENT_CACHE_HEAD}</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="torrent-cache-chips">
          {TORRENT_CACHE_MEGABYTES.map((choice) => (
            <Chip
              key={choice.megabytes}
              selected={heldTorrentCache === choice.megabytes}
              onClick={() => void pickTorrentCache(choice.megabytes)}
            >
              {choice.label}
            </Chip>
          ))}
          {!torrentCachePreset(heldTorrentCache) ? (
            <Chip selected>{formatTorrentCache(heldTorrentCache)}</Chip>
          ) : null}
        </div>
        <p className="mq-remote-large-subtitle">{TORRENT_FETCH_NOTE}</p>

        {torrentError ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(torrentError)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function UpNextSubLevel({
  session,
  state,
  pop,
}: {
  session: Session;
  state: SessionState;
  pop: () => void;
}) {
  const snapshot = state.snapshot;
  const meta = PREFERENCE_SUB_LEVELS["up-next"];
  const heldAutoplay = autoplayOn(snapshot);
  const heldPlayback = snapshot?.preferences.upNextPlayback ?? "direct";
  const featuredChoices = featuredCatalogChoices(snapshot);
  const currentFeatured = activeFeaturedKey(snapshot);
  const [error, setError] = useState<ActionError | null>(null);

  const send = async (action: Action) => {
    setError(null);
    const outcome = await session.ask(action);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  return (
    <section
      className="mq-remote-screen"
      aria-label={meta.title}
      data-testid="settings-sublevel-up-next"
    >
      <PhoneHeader title={meta.title} subtitle={meta.crumb} onBack={pop} />

      <div className="mq-remote-body">
        <p className="mq-remote-large-subtitle">{meta.intro}</p>

        <PhoneSwitchRow
          label={AUTOPLAY_SWITCH_LABEL}
          checked={heldAutoplay}
          onChange={(enabled) => void send({ type: "set_autoplay", autoplay: enabled })}
        />

        <GroupLabel>When Play is pressed on an Up next</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="up-next-playback-chips">
          {UP_NEXT_PLAYBACK_CHOICES.map((choice) => (
            <Chip
              key={choice.playback}
              selected={heldPlayback === choice.playback}
              onClick={() =>
                void send({ type: "set_up_next_playback", playback: choice.playback })
              }
            >
              {choice.label}
            </Chip>
          ))}
        </div>

        <GroupLabel>Featured catalog</GroupLabel>
        <div className="mq-remote-sub-chips" data-testid="featured-catalog-chips">
          <Chip
            selected={currentFeatured === null}
            onClick={() => void send(featuredCatalogAction(null))}
          >
            {NO_CATALOG}
          </Chip>
          {featuredChoices.map((choice) => (
            <Chip
              key={choice.key}
              selected={currentFeatured === choice.key}
              onClick={() => void send(featuredCatalogAction(choice.catalog))}
            >
              {choice.label}
            </Chip>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
