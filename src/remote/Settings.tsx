import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { version as appVersion } from "../../package.json";
import { catalogKey, declaredCatalogs, keyOf } from "../core/browse";
import {
  AUTOPLAY_CHOICES,
  AUTOPLAY_SETTING_LABEL,
  STREAM_BUFFER_DEFAULT_MEGABYTES,
  STREAM_BUFFER_DEFAULT_SECONDS,
  STREAM_BUFFER_MEGABYTES,
  STREAM_BUFFER_SECONDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  UP_NEXT_PLAYBACK_CHOICES,
  UP_NEXT_PLAYBACK_SETTING_LABEL,
  bufferMegabytesPreset,
  bufferSecondsPreset,
  colorSelected,
  formatBufferMegabytes,
  formatBufferSeconds,
  formatScale,
  scalePreset,
  scaleSelected,
} from "../core/controls";
import { explain, type ActionError } from "../core/errors";
import { HOST_PICKS_PER_VIDEO, SUBTITLE_LANGUAGES } from "../core/languages";
import type { NewLevel } from "../core/navigation";
import {
  LICENCE,
  NO_CATALOG,
  SETTINGS_CATEGORIES,
  TMDB_KEY_SAVED,
  TMDB_NOTICE,
  protectionLedger,
  settingsLevelId,
  unknownColorLabel,
  unknownLanguageLabel,
  type SettingsCategoryId,
} from "../core/settingsRegister";
import type { Session, SessionState } from "../core/session";
import type { Action } from "../core/wire";
import tmdbLogo from "../assets/tmdb-logo.svg";
import { Button } from "../kit/Button";
import { Chip, ChoiceChip } from "../kit/Chip";
import { Field } from "../kit/Field";
import type { RemotePayload } from "./levels";
import {
  ADDRESS_ABSENT,
  ADDRESS_LABEL,
  FEATURED_CATALOG_HEAD,
  FEATURED_NONE,
  NO_DEVICES,
  PAIRING_CODE_LABEL,
  REVOKE,
  SETTINGS_WAITING,
  STREAM_BUFFER_HEAD,
  STREAM_BUFFER_MEGABYTES_HEAD,
  STREAM_BUFFER_SECONDS_HEAD,
  STREMIO_EMAIL_LABEL,
  STREMIO_EMAIL_PLACEHOLDER,
  STREMIO_PASSWORD_LABEL,
  STREMIO_PASSWORD_PLACEHOLDER,
  STREMIO_SIGN_IN,
  STREMIO_SIGN_OUT,
  SUBTITLE_COLOUR_HEAD,
  SUBTITLE_LANGUAGE_HEAD,
  SUBTITLE_SIZE_HEAD,
  TMDB_CLEAR,
  TMDB_FIELD_LABEL,
  TMDB_FIELD_PLACEHOLDER,
  TMDB_MARK,
  TMDB_SAVE,
  UP_NEXT_PLAYBACK_HEAD,
  VERSION_TERM,
  autoplayRequest,
  bufferAfter,
  bufferRequest,
  clearTmdbLevel,
  colorRequest,
  featuredRequest,
  languageRequest,
  pairedAt,
  revokeLevel,
  scaleRequest,
  settingsCategoryOf,
  settingsLevel,
  signInRequest,
  signOutLevel,
  tmdbKeyRequest,
  upNextPlaybackRequest,
  type StreamBuffer,
} from "./settingsScreen";

export type SettingsProps = {
  /** A press on a category pushes its leaf over the register. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * Settings, as a short register (#211, ADR-0035 §1).
 *
 * The four categories are the Host's own, from the core's `settingsRegister`,
 * and choosing one pushes a level rather than replacing the destination, so
 * Back returns to the exact row that opened it. Each leaf sends the same
 * Actions the window's Settings does; nothing here holds a credential.
 */
export function Settings({ push }: SettingsProps) {
  return (
    <section className="remote-settings" data-testid="remote-settings">
      <ScreenHead title="Settings" />

      <ul className="remote-settings-register" data-testid="settings-categories">
        {SETTINGS_CATEGORIES.map((category) => (
          <li key={category.id} className="remote-settings-row">
            <Button
              variant="ghost"
              className="remote-settings-category"
              onClick={() => push(settingsLevel(category))}
            >
              {category.title}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type SettingsLeafProps = {
  /** The category the pushed level carries, by its register id. */
  category: SettingsCategoryId;
  /** The Session every leaf's Actions go through. */
  session: Session;
  /** What the Host last published: the ledger, the preferences, the devices. */
  state: SessionState;
  /** A destructive press pushes the confirmation B5's confirm level draws. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * One Settings leaf, drawn over the register.
 *
 * The level says which category it is; the leaf is the screen's own decision,
 * so the four leaves are small siblings of this component rather than a copy
 * table, and the record is what makes a fifth category a type error rather than
 * a leaf that silently draws nothing. Every refusal is the Host's words, kept
 * beside the control that asked.
 */
export function SettingsLeaf(props: SettingsLeafProps) {
  const Leaf = LEAVES[props.category];
  return <Leaf {...props} />;
}

/** The three props every leaf shares; the category is its own. */
type LeafProps = Omit<SettingsLeafProps, "category"> & {
  category: SettingsCategoryId;
};

/** One leaf per register category, in the register's own vocabulary. */
const LEAVES: Record<SettingsCategoryId, (props: LeafProps) => ReactNode> = {
  credentials: CredentialsLeaf,
  preferences: PreferencesLeaf,
  "remote-devices": RemoteDevicesLeaf,
  about: AboutLeaf,
};

/** A leaf's frame: its name on the screen's one line, and the leaf under it. */
function LeafFrame({
  category,
  children,
}: {
  category: SettingsCategoryId;
  children: ReactNode;
}) {
  const held = settingsCategoryOf(category);
  return (
    <section
      className="remote-settings-leaf"
      data-testid={settingsLevelId(held)}
    >
      <ScreenHead title={held.title} />
      {children}
    </section>
  );
}

/**
 * Credentials: the protection ledger, the TMDB key, and the Stremio account.
 *
 * The key is pasted once and never echoed — the ledger says whether the Host
 * holds one through `protectionLedger`, and a taken key is reported with
 * `TMDB_KEY_SAVED`. The Stremio form keeps no part of the password after the
 * Host has exchanged it, and both destructive controls are questions first.
 */
function CredentialsLeaf({ category, session, state, push }: LeafProps) {
  const snapshot = state.snapshot;
  const protection = snapshot ? protectionLedger(snapshot.protection) : null;
  const tmdbHeld = snapshot?.protection.tmdbHeld ?? false;
  const stremioHeld = snapshot?.protection.stremioHeld ?? false;

  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<ActionError | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signError, setSignError] = useState<ActionError | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const storeKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = tmdbKeyRequest(keyDraft);
    if (!action || savingKey) {
      return;
    }
    setKeyError(null);
    setKeySaved(false);
    setSavingKey(true);
    const outcome = await session.ask(action);
    setSavingKey(false);
    if (outcome.error) {
      // A refused key is something to correct, not retype.
      setKeyError(outcome.error);
      return;
    }
    // The field was the only place the value was ever shown: a taken key is a
    // fact about the secret store, never a value a Snapshot carries.
    setKeyDraft("");
    setKeySaved(true);
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = signInRequest(email, password);
    if (!action || signingIn) {
      return;
    }
    setSignError(null);
    setSigningIn(true);
    const outcome = await session.ask(action);
    setSigningIn(false);
    if (outcome.error) {
      // The Host's own answer, kept beside the fields so a typo can be fixed.
      setSignError(outcome.error);
      return;
    }
    // The password was only ever the draft: the Host exchanged it for the
    // account it holds, and this form keeps nothing of it.
    setEmail("");
    setPassword("");
  };

  return (
    <LeafFrame category={category}>
      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Protection</h2>
        {protection ? (
          <dl className="remote-facts" data-testid="settings-protection">
            <div>
              <dt>Secret store</dt>
              <dd>
                <Chip>{protection.backend}</Chip>
              </dd>
            </div>
            <div>
              <dt>TMDB key</dt>
              <dd data-testid="protection-tmdb">
                <Chip tone={tmdbHeld ? "ok" : "neutral"}>{protection.tmdb}</Chip>
              </dd>
            </div>
            <div>
              <dt>Stremio account</dt>
              <dd data-testid="protection-stremio">
                <Chip tone={stremioHeld ? "ok" : "neutral"}>
                  {protection.stremio}
                </Chip>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="remote-quiet">{SETTINGS_WAITING}</p>
        )}
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">TMDB key</h2>
        <form className="remote-settings-form" onSubmit={storeKey}>
          <Field
            id="settings-tmdb-key"
            label={TMDB_FIELD_LABEL}
            type="password"
            placeholder={TMDB_FIELD_PLACEHOLDER}
            autoComplete="off"
            value={keyDraft}
            onChange={setKeyDraft}
            error={keyError}
            refusalTestId="settings-tmdb-refusal"
          />
          <div className="remote-settings-actions">
            <Button
              type="submit"
              variant="primary"
              pending={savingKey}
              disabled={tmdbKeyRequest(keyDraft) === null}
            >
              {TMDB_SAVE}
            </Button>
            <Button
              variant="ghost"
              danger
              disabled={!tmdbHeld}
              onClick={() => push(clearTmdbLevel())}
            >
              {TMDB_CLEAR}
            </Button>
          </div>
          {keySaved && tmdbHeld ? (
            <p role="status" className="remote-settings-status">
              {TMDB_KEY_SAVED}
            </p>
          ) : null}
        </form>
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Stremio account</h2>
        {snapshot === null ? (
          <p className="remote-quiet">{SETTINGS_WAITING}</p>
        ) : stremioHeld ? (
          <Button
            variant="ghost"
            danger
            onClick={() => push(signOutLevel())}
          >
            {STREMIO_SIGN_OUT}
          </Button>
        ) : (
          <form className="remote-settings-form" onSubmit={signIn} noValidate>
            <Field
              id="settings-stremio-email"
              label={STREMIO_EMAIL_LABEL}
              type="email"
              placeholder={STREMIO_EMAIL_PLACEHOLDER}
              autoComplete="off"
              value={email}
              onChange={setEmail}
            />
            <Field
              id="settings-stremio-password"
              label={STREMIO_PASSWORD_LABEL}
              type="password"
              placeholder={STREMIO_PASSWORD_PLACEHOLDER}
              autoComplete="off"
              value={password}
              onChange={setPassword}
              error={signError}
              refusalTestId="settings-stremio-refusal"
            />
            <div className="remote-settings-actions">
              <Button
                type="submit"
                variant="primary"
                pending={signingIn}
                disabled={signInRequest(email, password) === null}
              >
                {STREMIO_SIGN_IN}
              </Button>
            </div>
          </form>
        )}
      </section>
    </LeafFrame>
  );
}

/**
 * Preferences: every control is the Host's own Action and saves on press.
 *
 * The lists are the core's JSON, so the Remote offers the same languages,
 * colours, sizes, buffer pair and Featured catalogs the window does. A value
 * the Host holds that a list does not name keeps an Other chip, so one choice
 * is still shown as chosen; a refusal is drawn beside the group that asked.
 */
function PreferencesLeaf({ category, session, state }: LeafProps) {
  const snapshot = state.snapshot;
  const heldLanguage = snapshot?.preferences.subtitleLanguage ?? null;
  const heldColor = snapshot?.preferences.subtitleColor ?? "#FFFFFF";
  const heldScale = snapshot?.preferences.subtitleScale ?? 1;
  const published: StreamBuffer = snapshot?.preferences.streamBuffer ?? {
    seconds: STREAM_BUFFER_DEFAULT_SECONDS,
    megabytes: STREAM_BUFFER_DEFAULT_MEGABYTES,
  };

  /**
   * The pair the chips draw before the Host has answered a press, so two quick
   * presses compose from the first rather than both from the same Snapshot.
   */
  const [bufferDraft, setBufferDraft] = useState<StreamBuffer>(published);
  useEffect(() => {
    setBufferDraft({
      seconds: published.seconds,
      megabytes: published.megabytes,
    });
  }, [published.seconds, published.megabytes]);

  const [languageError, setLanguageError] = useState<ActionError | null>(null);
  const [colorError, setColorError] = useState<ActionError | null>(null);
  const [scaleError, setScaleError] = useState<ActionError | null>(null);
  const [bufferError, setBufferError] = useState<ActionError | null>(null);
  const [upNextError, setUpNextError] = useState<ActionError | null>(null);
  const [featuredError, setFeaturedError] = useState<ActionError | null>(null);

  const known = SUBTITLE_LANGUAGES.some(
    (language) => language.tag === heldLanguage,
  );
  const otherColor = unknownColorLabel(heldColor);
  const heldUpNext = snapshot?.preferences.upNextPlayback ?? "direct";
  const heldAutoplay = snapshot?.preferences.autoplay ?? true;
  const catalogs = declaredCatalogs(snapshot);
  const featured = snapshot?.featuredCatalog ?? null;
  const featuredKey = featured
    ? keyOf({
        addon: featured.addon,
        type: featured.catalog.type,
        id: featured.catalog.id,
      })
    : null;

  const take = async (
    action: Action,
    setError: (error: ActionError | null) => void,
  ) => {
    setError(null);
    const outcome = await session.ask(action);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  /**
   * One press moves one of the pair and keeps the other where the client last
   * put it; a refusal puts the draft back to the published pair.
   */
  const pickBuffer = async (change: Partial<StreamBuffer>) => {
    const next = bufferAfter(bufferDraft, change);
    setBufferError(null);
    setBufferDraft(next);
    const outcome = await session.ask(bufferRequest(next));
    if (outcome.error) {
      setBufferError(outcome.error);
      setBufferDraft(published);
    }
  };

  return (
    <LeafFrame category={category}>
      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{SUBTITLE_LANGUAGE_HEAD}</h2>
        <div className="remote-settings-chips">
          <ChoiceChip
            pressed={heldLanguage === null}
            onClick={() => void take(languageRequest(null), setLanguageError)}
          >
            {HOST_PICKS_PER_VIDEO}
          </ChoiceChip>
          {heldLanguage && !known ? (
            <ChoiceChip
              pressed
              onClick={() => void take(languageRequest(heldLanguage), setLanguageError)}
            >
              {unknownLanguageLabel(heldLanguage)}
            </ChoiceChip>
          ) : null}
          {SUBTITLE_LANGUAGES.map((language) => (
            <ChoiceChip
              key={language.tag}
              pressed={heldLanguage === language.tag}
              onClick={() => void take(languageRequest(language.tag), setLanguageError)}
            >
              {language.name}
            </ChoiceChip>
          ))}
        </div>
        <Refusal error={languageError} />
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{SUBTITLE_COLOUR_HEAD}</h2>
        <div className="remote-settings-chips">
          {SUBTITLE_COLORS.map((choice) => (
            <ChoiceChip
              key={choice.color}
              pressed={colorSelected(heldColor, choice.color)}
              onClick={() => void take(colorRequest(choice.color), setColorError)}
            >
              {choice.label}
            </ChoiceChip>
          ))}
          {otherColor ? (
            <ChoiceChip
              pressed
              onClick={() => void take(colorRequest(heldColor), setColorError)}
            >
              {otherColor}
            </ChoiceChip>
          ) : null}
        </div>
        <Refusal error={colorError} />
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{SUBTITLE_SIZE_HEAD}</h2>
        <div className="remote-settings-chips">
          {SUBTITLE_SCALES.map((choice) => (
            <ChoiceChip
              key={choice.scale}
              pressed={scaleSelected(heldScale, choice.scale)}
              onClick={() => void take(scaleRequest(choice.scale), setScaleError)}
            >
              {`${choice.label} · ${formatScale(choice.scale)}`}
            </ChoiceChip>
          ))}
          {!scalePreset(heldScale) ? (
            <ChoiceChip
              pressed
              onClick={() => void take(scaleRequest(heldScale), setScaleError)}
            >
              {`Other (${formatScale(heldScale)})`}
            </ChoiceChip>
          ) : null}
        </div>
        <Refusal error={scaleError} />
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{STREAM_BUFFER_HEAD}</h2>
        <p className="remote-settings-sub">{STREAM_BUFFER_SECONDS_HEAD}</p>
        <div className="remote-settings-chips">
          {STREAM_BUFFER_SECONDS.map((choice) => (
            <ChoiceChip
              key={choice.seconds}
              pressed={bufferDraft.seconds === choice.seconds}
              onClick={() => void pickBuffer({ seconds: choice.seconds })}
            >
              {choice.label}
            </ChoiceChip>
          ))}
          {!bufferSecondsPreset(bufferDraft.seconds) ? (
            <ChoiceChip
              pressed
              onClick={() => void pickBuffer({ seconds: bufferDraft.seconds })}
            >
              {formatBufferSeconds(bufferDraft.seconds)}
            </ChoiceChip>
          ) : null}
        </div>

        <p className="remote-settings-sub">{STREAM_BUFFER_MEGABYTES_HEAD}</p>
        <div className="remote-settings-chips">
          {STREAM_BUFFER_MEGABYTES.map((choice) => (
            <ChoiceChip
              key={choice.megabytes}
              pressed={bufferDraft.megabytes === choice.megabytes}
              onClick={() => void pickBuffer({ megabytes: choice.megabytes })}
            >
              {choice.label}
            </ChoiceChip>
          ))}
          {!bufferMegabytesPreset(bufferDraft.megabytes) ? (
            <ChoiceChip
              pressed
              onClick={() => void pickBuffer({ megabytes: bufferDraft.megabytes })}
            >
              {formatBufferMegabytes(bufferDraft.megabytes)}
            </ChoiceChip>
          ) : null}
        </div>
        <Refusal error={bufferError} />
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{UP_NEXT_PLAYBACK_HEAD}</h2>
        <p className="remote-settings-sub">{AUTOPLAY_SETTING_LABEL}</p>
        <div className="remote-settings-chips">
          {AUTOPLAY_CHOICES.map((choice) => (
            <ChoiceChip
              key={String(choice.autoplay)}
              pressed={heldAutoplay === choice.autoplay}
              onClick={() =>
                void take(autoplayRequest(choice.autoplay), setUpNextError)
              }
            >
              {choice.label}
            </ChoiceChip>
          ))}
        </div>
        <p className="remote-settings-sub">{UP_NEXT_PLAYBACK_SETTING_LABEL}</p>
        <div className="remote-settings-chips">
          {UP_NEXT_PLAYBACK_CHOICES.map((choice) => (
            <ChoiceChip
              key={choice.playback}
              pressed={heldUpNext === choice.playback}
              onClick={() =>
                void take(
                  upNextPlaybackRequest(choice.playback),
                  setUpNextError,
                )
              }
            >
              {choice.label}
            </ChoiceChip>
          ))}
        </div>
        <Refusal error={upNextError} />
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">{FEATURED_CATALOG_HEAD}</h2>
        {snapshot === null ? (
          <p className="remote-quiet">{SETTINGS_WAITING}</p>
        ) : catalogs.length === 0 ? (
          <p className="remote-quiet">{NO_CATALOG}</p>
        ) : null}
        <div className="remote-settings-chips">
          <ChoiceChip
            pressed={featured === null}
            onClick={() => void take(featuredRequest(null), setFeaturedError)}
          >
            {FEATURED_NONE}
          </ChoiceChip>
          {catalogs.map((choice) => {
            const key = catalogKey(choice);
            const addon =
              snapshot?.addons.find((held) => held.id === choice.addon)?.name ??
              choice.addon;
            return (
              <ChoiceChip
                key={key}
                pressed={key === featuredKey}
                onClick={() => void take(featuredRequest(choice), setFeaturedError)}
              >
                {`${choice.catalog.name} · ${addon}`}
              </ChoiceChip>
            );
          })}
        </div>
        <Refusal error={featuredError} />
      </section>
    </LeafFrame>
  );
}

/**
 * Remote devices: the address and the pairing code a person reads out, the
 * Host's devices in the order they paired, and a Revoke behind a question.
 *
 * This is the screen a second device is paired from, so the code is drawn at
 * hand scale — big mono — rather than as a bookkeeping line.
 */
function RemoteDevicesLeaf({ category, state, push }: LeafProps) {
  const snapshot = state.snapshot;
  const devices = snapshot?.devices ?? [];

  return (
    <LeafFrame category={category}>
      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Pairing</h2>
        {snapshot ? (
          <div className="remote-pairing" data-testid="settings-pairing">
            <div className="remote-pairing-block">
              <p className="remote-settings-label">{ADDRESS_LABEL}</p>
              <p className="remote-pairing-value" data-testid="settings-address">
                {snapshot.address ?? ADDRESS_ABSENT}
              </p>
            </div>
            <div className="remote-pairing-block">
              <p className="remote-settings-label">{PAIRING_CODE_LABEL}</p>
              <p className="remote-pairing-code" data-testid="settings-pairing-code">
                {snapshot.pairingCode}
              </p>
            </div>
          </div>
        ) : (
          <p className="remote-quiet">{SETTINGS_WAITING}</p>
        )}
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Paired devices</h2>
        {snapshot === null ? (
          <p className="remote-quiet">{SETTINGS_WAITING}</p>
        ) : devices.length === 0 ? (
          <p className="remote-quiet" data-testid="settings-no-devices">
            {NO_DEVICES}
          </p>
        ) : (
          <ol className="remote-settings-devices" data-testid="settings-devices">
            {devices.map((device) => (
              <li
                key={device.id}
                className="remote-settings-device"
                data-testid={`settings-device-${device.id}`}
                data-device-id={device.id}
              >
                <span className="remote-settings-device-body">
                  <span className="remote-settings-device-name">{device.name}</span>
                  <span className="remote-settings-device-date">
                    paired{" "}
                    <time dateTime={new Date(device.pairedAt).toISOString()}>
                      {pairedAt(device.pairedAt)}
                    </time>
                  </span>
                </span>
                <Button
                  variant="ghost"
                  danger
                  aria-label={`${REVOKE} ${device.name}`}
                  onClick={() => push(revokeLevel(device))}
                >
                  {REVOKE}
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </LeafFrame>
  );
}

/**
 * About/Credits: the bundle's version, the TMDB mark and its required notice,
 * and the licence.
 *
 * The version is read from `package.json` through the build, so it is one
 * number in one place; the mark is the imported SVG, so no asset is fetched or
 * spliced at serve time.
 */
function AboutLeaf({ category }: LeafProps) {
  return (
    <LeafFrame category={category}>
      <section className="remote-settings-group">
        <h2 className="remote-settings-label">TMDB</h2>
        <div className="remote-credit" data-testid="settings-tmdb-credit">
          <img className="remote-credit-logo" src={tmdbLogo} alt={TMDB_MARK} />
          <p className="remote-credit-notice">{TMDB_NOTICE}</p>
        </div>
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Version</h2>
        <dl className="remote-facts">
          <div>
            <dt>{VERSION_TERM}</dt>
            <dd data-testid="settings-version">{appVersion}</dd>
          </div>
        </dl>
      </section>

      <section className="remote-settings-group">
        <h2 className="remote-settings-label">Licence</h2>
        <p className="remote-licence" data-testid="settings-licence">
          {LICENCE}
        </p>
      </section>
    </LeafFrame>
  );
}

/** A screen's one line: its name, then the hairline to the edge. */
function ScreenHead({ title }: { title: string }) {
  return (
    <header className="remote-screen-head">
      <h1 className="remote-screen-title">{title}</h1>
      <span className="remote-screen-rule" aria-hidden="true" />
    </header>
  );
}

/** The Host's own words for a refusal, announced where the control was. */
function Refusal({ error }: { error: ActionError | null }) {
  return error ? (
    <p role="alert" className="remote-failure">
      {explain(error)}
    </p>
  ) : null;
}
