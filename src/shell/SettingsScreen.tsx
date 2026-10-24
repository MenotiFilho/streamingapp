import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { catalogKey, declaredCatalogs, keyOf, type DeclaredCatalog } from "../browse";
import {
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  colorSelected,
  formatScale,
  scalePreset,
  scaleSelected,
} from "../controls";
import type { Action, ActionError, DeviceSummary } from "../host-client";
import {
  HOST_PICKS_PER_VIDEO,
  SUBTITLE_LANGUAGES,
  subtitleLanguageName,
} from "../languages";
import { version as appVersion } from "../../package.json";
import tmdbLogo from "../assets/tmdb-logo.svg";
import { useShell, type NewShellLevel } from "./context";
import { confirmActionLevel } from "./ConfirmAction";
import { Button, ChoiceChip } from "./kit";
import { Refusal } from "./Refusal";
import { focusAndReveal } from "./reveal";
import { StremioAccount } from "./StremioAccount";
import { protectionReadout } from "./settings";
import "./settings.css";

type SettingsCategory = {
  id: string;
  title: string;
  note: string;
  screen: () => ReactNode;
};

const CREDENTIALS_CATEGORY: SettingsCategory = {
  id: "credentials",
  title: "Credentials",
  note: "The secret store, the TMDB key, and the Stremio account.",
  screen: () => <CredentialsScreen />,
};

const CATEGORIES: readonly SettingsCategory[] = [
  CREDENTIALS_CATEGORY,
  {
    id: "preferences",
    title: "Preferences",
    note: "Subtitle language and appearance, and the one Catalog Home's hero is drawn from.",
    screen: () => <PreferencesScreen />,
  },
  {
    id: "remote-devices",
    title: "Remote devices",
    note: "The address a browser pairs with, the code, and paired devices.",
    screen: () => <RemoteDevicesScreen />,
  },
  {
    id: "about",
    title: "About/Credits",
    note: "The app version, the licences, and TMDB attribution.",
    screen: () => <AboutScreen />,
  },
];

/** The pushed level one category is, whether Settings or another screen opens it. */
function categoryLevel(category: SettingsCategory): NewShellLevel {
  return {
    id: `settings-${category.id}`,
    name: `Settings — ${category.title}`,
    kind: "overlay",
    render: category.screen,
  };
}

/**
 * Settings: four categories, each a sub-screen pushed over this list (#82).
 *
 * The category list is the base screen. Choosing one pushes a level — Back on
 * it pops to this exact list with the category's own focus — and a destructive
 * control inside a category pushes one level more, so Back always cancels the
 * nearest question first.
 */
export function SettingsScreen() {
  const { push } = useShell();

  return (
    <section className="settings-screen" data-testid="settings-screen">
      <h1 className="shell-screen-title">Settings</h1>
      <p className="shell-lede">
        The Host's credentials, preferences, paired devices, and the credits its
        software and data sources ask it to carry.
      </p>

      <ul
        className="settings-categories"
        data-testid="settings-categories"
        data-region="settings-categories"
        data-kind="row"
        data-label="Settings categories"
      >
        {CATEGORIES.map((category) => (
          <li key={category.id}>
            <Button
              className="settings-category"
              variant="secondary"
              aria-label={category.title}
              data-testid={`settings-category-${category.id}`}
              onClick={() => push(categoryLevel(category))}
            >
              <span className="settings-category-title">{category.title}</span>
              <span className="settings-category-note">{category.note}</span>
              <span className="settings-category-mark" aria-hidden="true">
                ›
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Credentials sub-screen as a pushed level, for another screen that points
 * at it: Discover's no-key state sends a person to where a key is saved without
 * pretending to be a Settings screen itself.
 */
export function credentialsLevel(): NewShellLevel {
  return categoryLevel(CREDENTIALS_CATEGORY);
}

/** The frame every Settings sub-screen shares: Back, a title, and a lede. */
function SettingsLevel({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  const { pop } = useShell();

  return (
    <section
      className="settings-level"
      data-testid={`settings-${id}`}
      data-region={`settings-${id}`}
      data-kind="branch"
      data-label={title}
    >
      <header className="settings-level-head">
        <Button
          variant="ghost"
          onClick={pop}
          data-testid={`settings-${id}-back`}
        >
          Back
        </Button>
        <h1 className="settings-level-title">{title}</h1>
        <p className="settings-level-lede">{lede}</p>
      </header>
      <div className="settings-level-body">{children}</div>
    </section>
  );
}

function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const headingId = `settings-${id}-heading`;
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-section-title">
        {title}
      </h2>
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
  const protection = snapshot ? protectionReadout(snapshot.protection) : null;

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
    // fact about the secret store, never a value the Snapshot carries.
    setKeyDraft("");
  };

  return (
    <SettingsLevel
      id="credentials"
      title="Credentials"
      lede="Where the Host keeps its credentials, which ones it holds, and the accounts it speaks to."
    >
      <SettingsSection id="protection" title="Protection">
        {protection ? (
          <dl className="settings-protection" data-testid="protection">
            <div>
              <dt>Secret store</dt>
              <dd data-testid="protection-backend">{protection.backend}</dd>
            </div>
            <div>
              <dt>TMDB key</dt>
              <dd data-testid="protection-tmdb">{protection.tmdb}</dd>
            </div>
            <div>
              <dt>Stremio account</dt>
              <dd data-testid="protection-stremio">{protection.stremio}</dd>
            </div>
          </dl>
        ) : (
          <p className="shell-note">Waiting for the Host…</p>
        )}
      </SettingsSection>

      <SettingsSection id="tmdb" title="TMDB key">
        <p className="settings-copy">
          TMDB supplies Discover, Search, and the metadata over a mapped Title.
          The Host reads the key when it asks, and no Snapshot carries it.
        </p>
        <form
          className="shell-form"
          data-region="settings-tmdb"
          data-kind="row"
          data-label="TMDB key"
          onSubmit={storeKey}
        >
          <div className="shell-field">
            <label htmlFor="settings-tmdb-key">TMDB API key or read-access token</label>
            <input
              id="settings-tmdb-key"
              type="password"
              autoComplete="off"
              placeholder="the key TMDB gave you"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              data-focusable
            />
          </div>
          <div className="shell-actions">
            <Button type="submit" variant="primary" pending={saving}>
              Save key
            </Button>
            <Button
              danger
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
                        The Host stops asking TMDB until a key is saved again.
                        Discover and keyed Search say so instead of answering.
                      </p>
                    ),
                  }),
                )
              }
            >
              Clear key
            </Button>
          </div>
          <Refusal error={keyError} testId="tmdb-key-error" />
        </form>
      </SettingsSection>

      <SettingsSection id="stremio" title="Stremio account">
        <p className="settings-copy">
          Sign in once and Watch progress travels both ways: what plays here
          appears in Stremio's own apps, and what is watched there is picked up
          here. Optional — with no account, nothing about the Host depends on
          Stremio.
        </p>
        <StremioAccount />
      </SettingsSection>
    </SettingsLevel>
  );
}

function PreferencesScreen() {
  const { snapshot, ask } = useShell();
  const heldLanguage = snapshot?.preferences.subtitleLanguage ?? null;
  const heldColor = snapshot?.preferences.subtitleColor ?? "#FFFFFF";
  const heldScale = snapshot?.preferences.subtitleScale ?? 1;
  const [languageError, setLanguageError] = useState<ActionError | null>(null);
  const [appearanceError, setAppearanceError] = useState<ActionError | null>(null);
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
    <SettingsLevel
      id="preferences"
      title="Preferences"
      lede="What the Host prefers when it picks and draws subtitles, and the Catalog Home's hero is drawn from."
    >
      <SettingsSection id="subtitle-language" title="Subtitle language">
        <p className="settings-copy" data-testid="subtitle-language">
          {heldLanguage
            ? `The Host asks mpv to prefer ${subtitleLanguageName(heldLanguage)} (${heldLanguage}).`
            : "The Host picks per Video — it asks mpv to match whatever subtitles the Stream carries."}
        </p>
        <div
          className="settings-choice-grid"
          data-region="settings-languages"
          data-kind="branch"
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
        <Refusal error={languageError} testId="subtitle-language-error" />
      </SettingsSection>

      <SettingsSection id="subtitle-appearance" title="Subtitle appearance">
        <p className="settings-copy" data-testid="subtitle-appearance">
          The colour and size the Player draws subtitles in, on every Stream. A
          subtitle file that carries its own styling — an ASS track — keeps the
          colour it was authored with, and this colour applies where the track
          leaves it open. The size applies to every subtitle.
        </p>
        <p className="settings-copy">Colour — white is the default.</p>
        <div
          className="settings-choice-grid"
          data-region="settings-subtitle-colors"
          data-kind="branch"
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
        <p className="settings-copy">Size — 100% is the default.</p>
        <div
          className="settings-choice-grid"
          data-region="settings-subtitle-scales"
          data-kind="branch"
          data-label="Subtitle size"
        >
          {SUBTITLE_SCALES.map((choice) => (
            <ChoiceChip
              key={choice.scale}
              pressed={scaleSelected(heldScale, choice.scale)}
              data-testid={`subtitle-scale-${choice.label.toLowerCase()}`}
              onClick={() => void pickAppearance({ type: "set_subtitle_scale", scale: choice.scale })}
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
        <Refusal error={appearanceError} testId="subtitle-appearance-error" />
      </SettingsSection>

      <SettingsSection id="featured-catalog" title="Featured catalog">
        <p className="settings-copy">
          The one Catalog Home draws its hero from, in the Addon's own order. A
          preference of the Host's, so every client draws the same hero.
        </p>
        {snapshot === null ? (
          <p className="shell-note">Waiting for the Host…</p>
        ) : catalogs.length === 0 ? (
          <p className="shell-note" data-testid="featured-empty">
            No configured Addon offers a Catalog, so there is nothing to feature.
          </p>
        ) : null}
        <div
          className="settings-choice-grid"
          data-region="settings-featured"
          data-kind="branch"
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
        <Refusal error={featuredError} testId="featured-catalog-error" />
      </SettingsSection>
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
            The device's token stops working immediately. Every other paired
            device keeps working.
          </p>
        ),
      }),
    );
  };

  return (
    <SettingsLevel
      id="remote-devices"
      title="Remote devices"
      lede="A browser on this network pairs with the address and code below, once. A device can be revoked on its own."
    >
      <SettingsSection id="pairing" title="Pairing">
        {snapshot ? (
          <dl className="settings-pairing">
            <div>
              <dt>Address</dt>
              <dd data-testid="remote-address">
                {snapshot.address ?? "This Host is not serving the network."}
              </dd>
            </div>
            <div>
              <dt>Pairing code</dt>
              <dd className="kit-tabular" data-testid="pairing-code">
                {snapshot.pairingCode}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="shell-note">Waiting for the Host…</p>
        )}
      </SettingsSection>

      <SettingsSection id="devices" title="Paired devices">
        <ul
          className="settings-devices"
          data-testid="devices"
          data-region="settings-devices"
          data-kind="row"
          data-label="Paired devices"
        >
          {devices.length === 0 ? (
            <li className="shell-note" data-testid="no-devices">
              No device is paired yet.
            </li>
          ) : (
            devices.map((device, index) => (
              <li key={device.id} data-testid={`device-${device.id}`}>
                <span className="settings-device-name">{device.name}</span>
                <span className="settings-device-date">
                  {`paired ${new Date(device.pairedAt).toLocaleString()}`}
                </span>
                <Button
                  danger
                  aria-label={`Revoke ${device.name}`}
                  data-revoke-device={device.id}
                  onClick={() => revoke(device, index)}
                >
                  Revoke
                </Button>
              </li>
            ))
          )}
        </ul>
      </SettingsSection>
    </SettingsLevel>
  );
}

function AboutScreen() {
  return (
    <SettingsLevel
      id="about"
      title="About/Credits"
      lede="The app, the software it is built from, and the data sources it thanks."
    >
      <SettingsSection id="tmdb" title="TMDB">
        <div className="settings-tmdb" data-testid="tmdb-credit">
          <img
            className="settings-tmdb-logo"
            src={tmdbLogo}
            alt="TMDB"
            data-testid="tmdb-logo"
          />
          <p className="settings-tmdb-notice" data-testid="tmdb-notice">
            This product uses the TMDB API but is not endorsed or certified by TMDB
          </p>
        </div>
      </SettingsSection>

      <SettingsSection id="version" title="Version">
        <p className="settings-copy">
          streamingapp{" "}
          <span className="kit-tabular" data-testid="app-version">
            {appVersion}
          </span>
        </p>
      </SettingsSection>

      <SettingsSection id="licences" title="Licences">
        <p className="settings-copy" data-testid="license-credits">
          streamingapp is free software, released under the GNU General Public
          License, version 3 or later (GPL-3.0-or-later). Playback uses mpv
          (libmpv), whose default build is GPLv2 or later, linked in-process so
          the video surface stays mpv's own.
        </p>
      </SettingsSection>
    </SettingsLevel>
  );
}
