import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { version as appVersion } from "../../../package.json";
import { catalogKey, declaredCatalogs, keyOf, type DeclaredCatalog } from "../../browse";
import {
  STREAM_BUFFER_DEFAULT_MEGABYTES,
  STREAM_BUFFER_DEFAULT_SECONDS,
  STREAM_BUFFER_MEGABYTES,
  STREAM_BUFFER_SECONDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  bufferMegabytesPreset,
  bufferSecondsPreset,
  colorSelected,
  formatBufferMegabytes,
  formatBufferSeconds,
  formatScale,
  scalePreset,
  scaleSelected,
} from "../../controls";
import type { Action, ActionError, DeviceSummary } from "../../host-client";
import {
  HOST_PICKS_PER_VIDEO,
  SUBTITLE_LANGUAGES,
  subtitleLanguageName,
} from "../../languages";
import tmdbLogo from "../../assets/tmdb-logo.svg";
import { useShell, type NewShellLevel } from "../context";
import { confirmActionLevel } from "../ConfirmAction";
import { Button, ChoiceChip } from "./kit";
import { focusAndReveal } from "../reveal";
import { StremioAccount } from "../StremioAccount";
import {
  LogFacts,
  LogGroup,
  LogHead,
  LogLevelHead,
  LogNote,
  LogPreviewNote,
  LogRefusal,
} from "./RepertoryLog";

/**
 * Settings as a short register (#147).
 *
 * The four categories are the Host's own — Credentials, Preferences, Remote
 * devices, About/Credits — and choosing one pushes a sub-screen over the list,
 * so Back returns to the exact row that opened it. Every control and every
 * Action is the one the Velvet surface already had; the drawing is deliberately
 * thin: one line for the destination, mono labels for sections, and only the
 * facts a person needs to act.
 */

type SettingsCategory = {
  id: string;
  title: string;
  screen: () => ReactNode;
};

const CREDENTIALS_CATEGORY: SettingsCategory = {
  id: "credentials",
  title: "Credentials",
  screen: () => <CredentialsScreen />,
};

const CATEGORIES: readonly SettingsCategory[] = [
  CREDENTIALS_CATEGORY,
  {
    id: "preferences",
    title: "Preferences",
    screen: () => <PreferencesScreen />,
  },
  {
    id: "remote-devices",
    title: "Remote devices",
    screen: () => <RemoteDevicesScreen />,
  },
  {
    id: "about",
    title: "About/Credits",
    screen: () => <AboutScreen />,
  },
];

function categoryLevel(category: SettingsCategory): NewShellLevel {
  return {
    id: `settings-${category.id}`,
    name: `Settings — ${category.title}`,
    kind: "overlay",
    render: category.screen,
  };
}

/**
 * The Credentials sub-screen as a level, for Discover's no-key state: the same
 * screen the Settings register opens, so the repertory flag never falls back to
 * the Velvet surface.
 */
export function repertoryCredentialsLevel(): NewShellLevel {
  return categoryLevel(CREDENTIALS_CATEGORY);
}

export function RepertorySettingsScreen() {
  const { push } = useShell();

  return (
    <section
      className="rep-log rep-log--settings"
      data-testid="settings-screen"
      data-region="settings"
      data-kind="branch"
      data-label="Settings"
    >
      <LogHead title="Settings" />

      <ul
        className="rep-log-list"
        data-testid="settings-categories"
        data-region="settings-categories"
        data-kind="branch"
        data-label="Settings categories"
      >
        {CATEGORIES.map((category) => (
          <li key={category.id} className="rep-log-row">
            <button
              type="button"
              className="rep-log-category"
              data-focusable
              aria-label={category.title}
              data-testid={`settings-category-${category.id}`}
              onClick={() => push(categoryLevel(category))}
            >
              <span className="rep-log-category-title">{category.title}</span>
              <span className="rep-log-row-mark">Open</span>
            </button>
          </li>
        ))}
      </ul>

      <LogPreviewNote>
        Preview data: preferences and credentials stay in this window.
      </LogPreviewNote>
    </section>
  );
}

/** A Settings sub-screen: Back, one title line, then its sections. */
function SettingsLevel({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rep-log rep-settings-level"
      data-testid={`settings-${id}`}
      data-region={`settings-${id}`}
      data-kind="branch"
      data-label={title}
    >
      <LogLevelHead title={title} backTestId={`settings-${id}-back`} />
      {children}
    </section>
  );
}

function CredentialsScreen() {
  const { snapshot, ask, push } = useShell();
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<ActionError | null>(null);
  const [saving, setSaving] = useState(false);
  const held = snapshot?.protection.tmdbHeld ?? false;
  const protection = snapshot?.protection ?? null;

  const storeKey = async (event: FormEvent) => {
    event.preventDefault();
    const key = keyDraft.trim();
    if (!key || saving) {
      return;
    }
    setKeyError(null);
    setSaving(true);
    const outcome = await ask({ type: "set_tmdb_key", key });
    setSaving(false);
    if (outcome.error) {
      setKeyError(outcome.error);
      return;
    }
    // The field is the only place the value was ever shown: a taken key is a
    // fact about the secret store, never a value a Snapshot carries.
    setKeyDraft("");
  };

  return (
    <SettingsLevel id="credentials" title="Credentials">
      <LogGroup id="settings-protection" title="Protection">
        {protection ? (
          <LogFacts
            testId="protection"
            rows={[
              {
                term: "Secret store",
                value:
                  protection.backend === "keyring"
                    ? "OS keyring"
                    : "Owner-only (0600) file",
                testId: "protection-backend",
              },
              {
                term: "TMDB key",
                value: protection.tmdbHeld ? "Held" : "Not held",
                testId: "protection-tmdb",
              },
              {
                term: "Stremio account",
                value: protection.stremioHeld ? "Signed in" : "Not signed in",
                testId: "protection-stremio",
              },
            ]}
          />
        ) : (
          <LogNote>Waiting for the Host…</LogNote>
        )}
      </LogGroup>

      <LogGroup id="settings-tmdb" title="TMDB key">
        <form
          className="rep-settings-form"
          data-region="settings-tmdb-form"
          data-kind="branch"
          data-label="TMDB key"
          onSubmit={storeKey}
        >
          <div className="rep-log-field">
            <label htmlFor="settings-tmdb-key">TMDB API key or read-access token</label>
            <input
              id="settings-tmdb-key"
              className="rep-log-input"
              type="password"
              autoComplete="off"
              placeholder="the key TMDB gave you"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              data-focusable
            />
          </div>
          <div className="rep-log-actions">
            <Button type="submit" variant="primary" pending={saving}>
              Save key
            </Button>
            <Button
              variant="ghost"
              danger
              className="rep-log-action rep-log-action--danger"
              disabled={!held}
              onClick={() =>
                push(
                  confirmActionLevel({
                    id: "confirm-clear-tmdb",
                    title: "Clear the TMDB key?",
                    confirmLabel: "Clear key",
                    testId: "confirm-clear-tmdb",
                    action: { type: "clear_tmdb_key" },
                    children: (
                      <p>
                        The Host stops asking TMDB until a key is saved again. Discover
                        and keyed Search say so instead of answering.
                      </p>
                    ),
                  }),
                )
              }
            >
              Clear key
            </Button>
          </div>
          <LogRefusal error={keyError} testId="tmdb-key-error" />
        </form>
      </LogGroup>

      <LogGroup id="settings-stremio" title="Stremio account">
        <div
          className="rep-log-signin"
          data-region="settings-stremio-form"
          data-kind="branch"
          data-label="Stremio account"
        >
          <StremioAccount />
        </div>
      </LogGroup>
    </SettingsLevel>
  );
}

function PreferencesScreen() {
  const { snapshot, ask } = useShell();
  const heldLanguage = snapshot?.preferences.subtitleLanguage ?? null;
  const heldColor = snapshot?.preferences.subtitleColor ?? "#FFFFFF";
  const heldScale = snapshot?.preferences.subtitleScale ?? 1;
  const publishedBuffer = snapshot?.preferences.streamBuffer ?? {
    seconds: STREAM_BUFFER_DEFAULT_SECONDS,
    megabytes: STREAM_BUFFER_DEFAULT_MEGABYTES,
  };
  /**
   * The pair the chips draw before the Host has answered a press. Without it,
   * two quick presses compose from the same Snapshot and the second silently
   * reverts the first (ADR-0026's "the two cannot drift apart").
   */
  const [bufferDraft, setBufferDraft] = useState(publishedBuffer);
  useEffect(() => {
    setBufferDraft(publishedBuffer);
  }, [publishedBuffer.seconds, publishedBuffer.megabytes]);
  const heldBuffer = bufferDraft;
  const [languageError, setLanguageError] = useState<ActionError | null>(null);
  const [appearanceError, setAppearanceError] = useState<ActionError | null>(null);
  const [bufferError, setBufferError] = useState<ActionError | null>(null);
  const [featuredError, setFeaturedError] = useState<ActionError | null>(null);

  const known = SUBTITLE_LANGUAGES.some((language) => language.tag === heldLanguage);
  const catalogs = declaredCatalogs(snapshot);
  const featured = snapshot?.featuredCatalog ?? null;
  const featuredKey = featured
    ? keyOf({
        addon: featured.addon,
        type: featured.catalog.type,
        id: featured.catalog.id,
      })
    : null;

  const pickLanguage = async (language: string | null) => {
    setLanguageError(null);
    const outcome = await ask(
      language === null
        ? { type: "clear_subtitle_language" }
        : { type: "set_subtitle_language", language },
    );
    if (outcome.error) {
      setLanguageError(outcome.error);
    }
  };

  const pickAppearance = async (action: Action) => {
    setAppearanceError(null);
    const outcome = await ask(action);
    if (outcome.error) {
      setAppearanceError(outcome.error);
    }
  };

  /**
   * One press moves one of the pair and keeps the other where the client last
   * put it: the Action carries both, and the draft moves before the Host
   * answers so a second press composes from the first (ADR-0026).
   */
  const pickBuffer = async (seconds: number, megabytes: number) => {
    setBufferError(null);
    const next = { seconds, megabytes };
    setBufferDraft(next);
    const outcome = await ask({ type: "set_stream_buffer", ...next });
    if (outcome.error) {
      setBufferError(outcome.error);
      setBufferDraft(publishedBuffer);
    }
  };

  const pickFeatured = async (choice: DeclaredCatalog | null) => {
    setFeaturedError(null);
    const outcome = await ask(
      choice === null
        ? { type: "clear_featured_catalog" }
        : {
            type: "set_featured_catalog",
            addon: choice.addon,
            catalog: { type: choice.catalog.type, id: choice.catalog.id },
          },
    );
    if (outcome.error) {
      setFeaturedError(outcome.error);
    }
  };

  return (
    <SettingsLevel id="preferences" title="Preferences">
      <LogGroup id="settings-subtitle-language" title="Subtitle language">
        <div
          className="rep-log-chips"
          data-region="settings-languages"
          data-kind="row"
          data-label="Subtitle languages"
        >
          <ChoiceChip
            pressed={heldLanguage === null}
            data-testid="language-host-picks"
            onClick={() => void pickLanguage(null)}
          >
            {HOST_PICKS_PER_VIDEO}
          </ChoiceChip>
          {heldLanguage && !known ? (
            <ChoiceChip
              pressed
              data-testid={`language-${heldLanguage}`}
              onClick={() => void pickLanguage(heldLanguage)}
            >
              {`${subtitleLanguageName(heldLanguage)} (${heldLanguage})`}
            </ChoiceChip>
          ) : null}
          {SUBTITLE_LANGUAGES.map((language) => (
            <ChoiceChip
              key={language.tag}
              pressed={heldLanguage === language.tag}
              data-testid={`language-${language.tag}`}
              onClick={() => void pickLanguage(language.tag)}
            >
              {language.name}
            </ChoiceChip>
          ))}
        </div>
        <LogRefusal error={languageError} testId="subtitle-language-error" />
      </LogGroup>

      <LogGroup id="settings-subtitle-appearance" title="Subtitle appearance">
        <div className="rep-log-choice-group">
          <p className="rep-log-choice-label">Colour</p>
          <div
            className="rep-log-chips"
            data-region="settings-subtitle-colors"
            data-kind="row"
            data-label="Subtitle colour"
          >
            {SUBTITLE_COLORS.map((choice) => (
              <ChoiceChip
                key={choice.color}
                pressed={colorSelected(heldColor, choice.color)}
                data-testid={`subtitle-color-${choice.label.toLowerCase()}`}
                onClick={() =>
                  void pickAppearance({ type: "set_subtitle_color", color: choice.color })
                }
              >
                {choice.label}
              </ChoiceChip>
            ))}
          </div>
        </div>
        <div className="rep-log-choice-group">
          <p className="rep-log-choice-label">Size</p>
          <div
            className="rep-log-chips"
            data-region="settings-subtitle-scales"
            data-kind="row"
            data-label="Subtitle size"
          >
            {SUBTITLE_SCALES.map((choice) => (
              <ChoiceChip
                key={choice.scale}
                pressed={scaleSelected(heldScale, choice.scale)}
                data-testid={`subtitle-scale-${choice.label.toLowerCase()}`}
                onClick={() =>
                  void pickAppearance({ type: "set_subtitle_scale", scale: choice.scale })
                }
              >
                {`${choice.label} · ${formatScale(choice.scale)}`}
              </ChoiceChip>
            ))}
            {!scalePreset(heldScale) ? (
              <ChoiceChip
                pressed
                data-testid="subtitle-scale-other"
                onClick={() =>
                  void pickAppearance({ type: "set_subtitle_scale", scale: heldScale })
                }
              >
                {`Other (${formatScale(heldScale)})`}
              </ChoiceChip>
            ) : null}
          </div>
        </div>
        <LogRefusal error={appearanceError} testId="subtitle-appearance-error" />
      </LogGroup>

      <LogGroup id="settings-stream-buffer" title="Stream buffer">
        <div className="rep-log-choice-group">
          <p className="rep-log-choice-label">Look-ahead</p>
          <div
            className="rep-log-chips"
            data-region="settings-buffer-seconds"
            data-kind="row"
            data-label="Stream buffer time"
          >
            {STREAM_BUFFER_SECONDS.map((choice) => (
              <ChoiceChip
                key={choice.seconds}
                pressed={heldBuffer.seconds === choice.seconds}
                data-testid={`buffer-seconds-${choice.seconds}`}
                onClick={() => void pickBuffer(choice.seconds, heldBuffer.megabytes)}
              >
                {choice.label}
              </ChoiceChip>
            ))}
            {!bufferSecondsPreset(heldBuffer.seconds) ? (
              <ChoiceChip
                pressed
                data-testid="buffer-seconds-other"
                onClick={() => void pickBuffer(heldBuffer.seconds, heldBuffer.megabytes)}
              >
                {formatBufferSeconds(heldBuffer.seconds)}
              </ChoiceChip>
            ) : null}
          </div>
        </div>
        <div className="rep-log-choice-group">
          <p className="rep-log-choice-label">Memory ceiling</p>
          <div
            className="rep-log-chips"
            data-region="settings-buffer-megabytes"
            data-kind="row"
            data-label="Stream buffer memory"
          >
            {STREAM_BUFFER_MEGABYTES.map((choice) => (
              <ChoiceChip
                key={choice.megabytes}
                pressed={heldBuffer.megabytes === choice.megabytes}
                data-testid={`buffer-megabytes-${choice.megabytes}`}
                onClick={() => void pickBuffer(heldBuffer.seconds, choice.megabytes)}
              >
                {choice.label}
              </ChoiceChip>
            ))}
            {!bufferMegabytesPreset(heldBuffer.megabytes) ? (
              <ChoiceChip
                pressed
                data-testid="buffer-megabytes-other"
                onClick={() => void pickBuffer(heldBuffer.seconds, heldBuffer.megabytes)}
              >
                {formatBufferMegabytes(heldBuffer.megabytes)}
              </ChoiceChip>
            ) : null}
          </div>
        </div>
        <LogRefusal error={bufferError} testId="stream-buffer-error" />
      </LogGroup>

      <LogGroup id="settings-featured-catalog" title="Featured catalog">
        {snapshot === null ? (
          <LogNote>Waiting for the Host…</LogNote>
        ) : catalogs.length === 0 ? (
          <p className="rep-log-note" data-testid="featured-empty">
            No configured Addon offers a Catalog.
          </p>
        ) : null}
        <div
          className="rep-log-chips"
          data-region="settings-featured"
          data-kind="row"
          data-label="Featured catalog"
        >
          <ChoiceChip
            pressed={featured === null}
            data-testid="featured-none"
            onClick={() => void pickFeatured(null)}
          >
            No featured catalog
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
                data-testid={`featured-${key}`}
                onClick={() => void pickFeatured(choice)}
              >
                {`${choice.catalog.name} · ${addon}`}
              </ChoiceChip>
            );
          })}
        </div>
        <LogRefusal error={featuredError} testId="featured-catalog-error" />
      </LogGroup>
    </SettingsLevel>
  );
}

function RemoteDevicesScreen() {
  const { snapshot, push } = useShell();
  const devices = snapshot?.devices ?? [];
  /**
   * A revoked device is one row, but the preceding control is what a person
   * means when their device disappears. The generic engine counts controls;
   * here the row before — or the sub-screen's Back when there is none — is
   * named explicitly.
   */
  const [rehome, setRehome] = useState<{ removed: string; previous: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!rehome || devices.some((device) => device.id === rehome.removed)) {
      return;
    }
    const target = rehome.previous
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-revoke-device]")).find(
          (element) => element.dataset.revokeDevice === rehome.previous,
        )
      : document.querySelector<HTMLElement>(
          '[data-testid="settings-remote-devices-back"]',
        );
    focusAndReveal(target);
    setRehome(null);
  }, [devices, rehome]);

  const revoke = (device: DeviceSummary, index: number) => {
    push(
      confirmActionLevel({
        id: `confirm-revoke-${device.id}`,
        title: `Revoke ${device.name}?`,
        confirmLabel: "Revoke",
        testId: `confirm-revoke-${device.id}`,
        action: { type: "revoke_device", id: device.id },
        onConfirmed: () =>
          setRehome({ removed: device.id, previous: devices[index - 1]?.id ?? null }),
        children: (
          <p>
            The device's token stops working immediately. Every other paired device keeps
            working.
          </p>
        ),
      }),
    );
  };

  return (
    <SettingsLevel id="remote-devices" title="Remote devices">
      <LogGroup id="settings-pairing" title="Pairing">
        {snapshot ? (
          <div className="rep-pairing" data-testid="pairing">
            <div className="rep-pairing-block">
              <p className="rep-pairing-label">Address</p>
              <p className="rep-pairing-value" data-testid="remote-address">
                {snapshot.address ?? "This Host is not serving the network."}
              </p>
            </div>
            <div className="rep-pairing-block rep-pairing-block--code">
              <p className="rep-pairing-label">Pairing code · single use</p>
              <p className="rep-pairing-code" data-testid="pairing-code">
                {snapshot.pairingCode}
              </p>
            </div>
          </div>
        ) : (
          <LogNote>Waiting for the Host…</LogNote>
        )}
      </LogGroup>

      <LogGroup id="settings-devices" title="Paired devices">
        {devices.length === 0 ? (
          <p className="rep-log-note" data-testid="no-devices">
            No device is paired yet.
          </p>
        ) : (
          <ul
            className="rep-log-list"
            data-testid="devices"
            data-region="settings-devices-list"
            data-kind="branch"
            data-label="Paired devices"
          >
            {devices.map((device, index) => (
              <li
                key={device.id}
                className="rep-log-row rep-log-device"
                data-testid={`device-${device.id}`}
              >
                <span className="rep-log-device-body">
                  <span className="rep-log-device-name">{device.name}</span>
                  <span className="rep-log-device-date">
                    paired{" "}
                    <time dateTime={new Date(device.pairedAt).toISOString()}>
                      {pairedAt(device.pairedAt)}
                    </time>
                  </span>
                </span>
                <Button
                  variant="ghost"
                  danger
                  className="rep-log-action rep-log-action--danger"
                  aria-label={`Revoke ${device.name}`}
                  data-revoke-device={device.id}
                  onClick={() => revoke(device, index)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LogGroup>

      <LogPreviewNote>
        Preview data: the address, code and devices are samples.
      </LogPreviewNote>
    </SettingsLevel>
  );
}

function AboutScreen() {
  return (
    <SettingsLevel id="about" title="About/Credits">
      <LogGroup id="settings-tmdb" title="TMDB">
        <div className="rep-credit" data-testid="tmdb-credit">
          <img
            className="rep-credit-logo"
            src={tmdbLogo}
            alt="TMDB"
            data-testid="tmdb-logo"
          />
          <p className="rep-credit-notice" data-testid="tmdb-notice">
            This product uses the TMDB API but is not endorsed or certified by TMDB
          </p>
        </div>
      </LogGroup>

      <LogGroup id="settings-version" title="Version">
        <LogFacts
          rows={[
            {
              term: "streamingapp",
              value: <span data-testid="app-version">{appVersion}</span>,
            },
          ]}
        />
      </LogGroup>

      <LogGroup id="settings-licences" title="Licences">
        <p className="rep-log-note" data-testid="license-credits">
          streamingapp is free software, released under the GNU General Public License,
          version 3 or later (GPL-3.0-or-later). Playback uses mpv (libmpv), whose default
          build is GPLv2 or later, linked in-process so the video surface stays mpv's own.
        </p>
      </LogGroup>
    </SettingsLevel>
  );
}

/** A paired-at stamp as a ledger would print it. */
function pairedAt(milliseconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(milliseconds));
}
