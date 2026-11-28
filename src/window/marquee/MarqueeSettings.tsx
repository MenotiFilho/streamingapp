import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { version as appVersion } from "../../../package.json";
import tmdbLogo from "../../assets/tmdb-logo.svg";
import { explain, type ActionError } from "../../core/errors";
import {
  PREFERENCE_SUB_LEVELS,
  formatPairedDetail,
  preferenceListEntries,
  type PreferenceSubLevelId,
} from "../../core/marqueeSettings";
import {
  CREDENTIALS_CATEGORY,
  LICENCE,
  SETTINGS_CATEGORIES,
  TMDB_KEY_SAVED,
  TMDB_NOTICE,
  protectionLedger,
  settingsLevelId,
  settingsLevelName,
  type SettingsCategoryId,
} from "../../core/settingsRegister";
import type { DeviceSummary } from "../../core/wire";
import { versionLabel } from "../../kit/marquee/AddonRow";
import { Button } from "../../kit/marquee/Button";
import { CategoryItem } from "../../kit/marquee/CategoryItem";
import { DeviceRow } from "../../kit/marquee/DeviceRow";
import { IconButton } from "../../kit/marquee/IconButton";
import { ListRow } from "../../kit/marquee/ListRow";
import { PairingCode } from "../../kit/marquee/PairingCode";
import { ScreenTitle } from "../../kit/marquee/ScreenTitle";
import { TextField } from "../../kit/marquee/TextField";
import { useShell, type NewShellLevel } from "../context";
import { focusAndReveal } from "../reveal";
import { marqueeConfirmLevel } from "./MarqueeConfirm";
import { renderPreferenceSubLevel } from "./MarqueeSettingsSubLevels";
import "./marqueeSettingsAddons.css";

/**
 * Shared two-column Settings layout (`19`–`27`): left column holds the ScreenTitle
 * and the four CategoryItems; right column holds the active category or pushed
 * Preferences sub-level.
 */
function SettingsFrame({
  activeCategory,
  onSelectCategory,
  testId,
  children,
}: {
  activeCategory: SettingsCategoryId;
  onSelectCategory: (id: SettingsCategoryId) => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="mq-screen mq-settings-screen"
      data-testid={testId}
      data-region="settings"
      data-kind="branch"
      data-label="Settings"
    >
      <ScreenTitle title="Settings" />

      <div className="mq-settings-columns">
        <nav
          className="mq-settings-categories"
          aria-label="Settings categories"
          data-testid="settings-categories"
          data-region="settings-categories"
          data-kind="branch"
          data-label="Settings categories"
        >
          {SETTINGS_CATEGORIES.map((category) => (
            <CategoryItem
              key={category.id}
              label={category.title}
              active={category.id === activeCategory}
              onPress={() => onSelectCategory(category.id)}
            />
          ))}
        </nav>

        <div
          className="mq-settings-pane"
          data-region="settings-pane"
          data-kind="branch"
          data-label="Settings detail"
        >
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * Marquee Settings (`19.jpg`–`27.jpg`, `docs/design-system.md` §8):
 * - Four categories (`Credentials`, `Preferences`, `Remote devices`, `About/Credits`).
 * - Preferences opens with an inline Autoplay switch and pushes `settings-*`
 *   sub-levels onto the Shell's level stack so Back pops one sub-level and
 *   restores focus to the row that opened it.
 */
export function MarqueeSettings() {
  const { push, pop } = useShell();
  const [category, setCategory] = useState<SettingsCategoryId>("preferences");

  const openSubLevel = (subId: PreferenceSubLevelId) => {
    const meta = PREFERENCE_SUB_LEVELS[subId];
    push({
      id: meta.levelId,
      name: `Settings — ${meta.title}`,
      kind: "overlay",
      payload: {
        render: () => (
          <SettingsFrame
            activeCategory="preferences"
            onSelectCategory={(next) => {
              setCategory(next);
              pop();
            }}
            testId={meta.levelId}
          >
            {renderPreferenceSubLevel(subId)}
          </SettingsFrame>
        ),
      },
    });
  };

  return (
    <SettingsFrame
      activeCategory={category}
      onSelectCategory={setCategory}
      testId="settings-screen"
    >
      {category === "preferences" ? (
        <PreferencesPane onOpenSubLevel={openSubLevel} />
      ) : category === "credentials" ? (
        <CredentialsPane />
      ) : category === "remote-devices" ? (
        <RemoteDevicesPane />
      ) : (
        <AboutPane />
      )}
    </SettingsFrame>
  );
}

/**
 * Standalone Credentials level (for Discover's no-key state, mirroring
 * `repertoryCredentialsLevel`). Back returns to the caller's screen.
 */
export function marqueeCredentialsLevel(): NewShellLevel {
  const id = settingsLevelId(CREDENTIALS_CATEGORY);
  return {
    id,
    name: settingsLevelName(CREDENTIALS_CATEGORY),
    kind: "overlay",
    payload: {
      render: () => <StandAloneCredentialsLevel />,
    },
  };
}

function StandAloneCredentialsLevel() {
  const { pop, choose } = useShell();
  return (
    <SettingsFrame
      activeCategory="credentials"
      onSelectCategory={(next) => {
        if (next === "credentials") {
          return;
        }
        pop();
        choose("settings");
      }}
      testId="settings-credentials"
    >
      <div className="mq-settings-pane-inner">
        <div className="mq-settings-subhead-bar">
          <IconButton
            icon="arrow-left"
            kind="glass"
            size="sm"
            label="Back"
            autoFocus
            data-testid="settings-credentials-back"
            onClick={pop}
          />
          <h2 className="mq-settings-cat-title">Credentials</h2>
        </div>
        <CredentialsPane showHeading={false} />
      </div>
    </SettingsFrame>
  );
}

function PreferencesPane({
  onOpenSubLevel,
}: {
  onOpenSubLevel: (id: PreferenceSubLevelId) => void;
}) {
  const { snapshot, ask } = useShell();
  const [autoplayError, setAutoplayError] = useState<ActionError | null>(null);
  const rows = preferenceListEntries(snapshot);

  const toggleAutoplay = async (autoplay: boolean) => {
    setAutoplayError(null);
    const outcome = await ask({ type: "set_autoplay", autoplay });
    if (outcome.error) {
      setAutoplayError(outcome.error);
    }
  };

  return (
    <div className="mq-settings-pane-inner" data-testid="settings-pane-preferences">
      <h2 className="mq-settings-cat-title">Preferences</h2>
      <div
        className="mq-settings-rows"
        data-region="settings-preferences-list"
        data-kind="branch"
        data-label="Preferences"
      >
        {rows.map((entry) =>
          entry.kind === "switch" ? (
            <ListRow
              key={entry.id}
              icon={entry.icon}
              label={entry.label}
              checked={entry.checked}
              onToggle={(next) => void toggleAutoplay(next)}
            />
          ) : (
            <ListRow
              key={entry.id}
              icon={entry.icon}
              label={entry.label}
              value={entry.value}
              onPress={() => onOpenSubLevel(entry.subLevel)}
            />
          ),
        )}
      </div>
      {autoplayError ? (
        <p role="alert" className="mq-inline-refusal" data-testid="autoplay-error">
          {explain(autoplayError)}
        </p>
      ) : null}
    </div>
  );
}

function CredentialsPane({ showHeading = true }: { showHeading?: boolean }) {
  const { snapshot, ask, push } = useShell();
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<ActionError | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const held = snapshot?.protection.tmdbHeld ?? false;
  const protection = snapshot ? protectionLedger(snapshot.protection) : null;

  const storeKey = async (event: FormEvent) => {
    event.preventDefault();
    const key = keyDraft.trim();
    if (!key || savingKey) {
      return;
    }
    setKeyError(null);
    setKeySaved(false);
    setSavingKey(true);
    const outcome = await ask({ type: "set_tmdb_key", key });
    setSavingKey(false);
    if (outcome.error) {
      setKeyError(outcome.error);
      return;
    }
    setKeyDraft("");
    setKeySaved(true);
  };

  return (
    <div className="mq-settings-pane-inner" data-testid="settings-pane-credentials">
      {showHeading ? <h2 className="mq-settings-cat-title">Credentials</h2> : null}

      {protection ? (
        <dl className="mq-facts" data-testid="protection">
          <div className="mq-facts-row">
            <dt className="mq-facts-term">Secret store</dt>
            <dd className="mq-facts-value" data-testid="protection-backend">
              {protection.backend}
            </dd>
          </div>
          <div className="mq-facts-row">
            <dt className="mq-facts-term">TMDB key</dt>
            <dd
              className="mq-facts-value"
              data-accent={snapshot?.protection.tmdbHeld || undefined}
              data-testid="protection-tmdb"
            >
              {protection.tmdb}
            </dd>
          </div>
          <div className="mq-facts-row">
            <dt className="mq-facts-term">Stremio account</dt>
            <dd
              className="mq-facts-value"
              data-accent={snapshot?.protection.stremioHeld || undefined}
              data-testid="protection-stremio"
            >
              {protection.stremio}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mq-settings-note" role="status">
          Waiting for the Host…
        </p>
      )}

      <form
        className="mq-settings-form"
        data-region="settings-tmdb-form"
        data-kind="branch"
        data-label="TMDB key"
        onSubmit={(event) => void storeKey(event)}
      >
        <TextField
          id="settings-tmdb-key"
          label="TMDB API key or read-access token"
          masked
          placeholder="the key TMDB gave you"
          value={keyDraft}
          onChange={setKeyDraft}
          error={keyError ? explain(keyError) : null}
        />
        <div
          className="mq-settings-actions"
          data-region="settings-tmdb-actions"
          data-kind="row"
          data-label="TMDB key actions"
        >
          <Button type="submit" kind="primary" size="md" disabled={savingKey}>
            Save key
          </Button>
          {held ? (
            <Button
              kind="ghost"
              size="md"
              icon="trash"
              className="mq-btn-danger-text"
              onClick={() =>
                push(
                  marqueeConfirmLevel({
                    id: "confirm-clear-tmdb",
                    title: "Clear the TMDB key?",
                    confirmLabel: "Clear key",
                    danger: true,
                    action: { type: "clear_tmdb_key" },
                    onConfirmed: () => setKeySaved(false),
                    body: "The Host stops asking TMDB until a key is saved again. Discover and keyed Search say so instead of answering.",
                  }),
                )
              }
            >
              Clear key
            </Button>
          ) : null}
        </div>
        {keySaved && held ? (
          <p className="mq-inline-status" role="status" data-testid="tmdb-key-status">
            {TMDB_KEY_SAVED}
          </p>
        ) : null}
      </form>

      <div
        className="mq-settings-section"
        data-region="settings-stremio-form"
        data-kind="branch"
        data-label="Stremio account"
      >
        <h3 className="mq-settings-section-title">Stremio account</h3>
        <MarqueeStremioAccount />
      </div>
    </div>
  );
}

function MarqueeStremioAccount() {
  const { snapshot, ask, push } = useShell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ActionError | null>(null);
  const [working, setWorking] = useState(false);

  if (!snapshot) {
    return (
      <p className="mq-settings-note" role="status">
        Waiting for the Host…
      </p>
    );
  }

  if (snapshot.protection.stremioHeld) {
    return (
      <div className="mq-account-card" data-testid="stremio-signed-in">
        <div className="mq-account-copy">
          <span className="mq-account-state">Signed in</span>
          <span className="mq-account-detail">
            Watch progress syncs both ways · the Library is read from the account
          </span>
        </div>
        <Button
          kind="secondary"
          size="md"
          onClick={() =>
            push(
              marqueeConfirmLevel({
                id: "confirm-sign-out-stremio",
                title: "Sign out of Stremio?",
                confirmLabel: "Sign out",
                danger: true,
                action: { type: "sign_out_stremio" },
                body: "The Host stops syncing Watch progress with this account. Progress already merged stays recorded.",
              }),
            )
          }
        >
          Sign out
        </Button>
      </div>
    );
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (working) {
      return;
    }
    setError(null);
    setWorking(true);
    const outcome = await ask({
      type: "sign_in_stremio",
      email: email.trim(),
      password,
    });
    setWorking(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setEmail("");
    setPassword("");
  };

  return (
    <form className="mq-settings-form" onSubmit={(event) => void signIn(event)} noValidate>
      <TextField
        id="settings-stremio-email"
        label="Stremio email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={setEmail}
      />
      <TextField
        id="settings-stremio-password"
        label="Stremio password"
        masked
        placeholder="the password Stremio knows"
        value={password}
        onChange={setPassword}
      />
      <div className="mq-settings-actions">
        <Button type="submit" kind="primary" size="md" disabled={working}>
          Sign in
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mq-inline-refusal" data-testid="stremio-sign-in-error">
          {explain(error)}
        </p>
      ) : null}
    </form>
  );
}

function RemoteDevicesPane() {
  const { snapshot, push } = useShell();
  const paneRef = useRef<HTMLDivElement | null>(null);
  const devices = snapshot?.devices ?? [];
  const [rehome, setRehome] = useState<{ removed: string; previous: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!rehome || devices.some((device) => device.id === rehome.removed)) {
      return;
    }
    const root = paneRef.current;
    const target = rehome.previous
      ? Array.from(root?.querySelectorAll<HTMLElement>("[data-revoke-device]") ?? [])
          .find((element) => element.dataset.revokeDevice === rehome.previous)
          ?.querySelector<HTMLElement>("button")
      : document.querySelector<HTMLElement>('[data-testid="settings-categories"] [aria-current="page"]');
    focusAndReveal(target ?? null);
    setRehome(null);
  }, [devices, rehome]);

  const revoke = (device: DeviceSummary, index: number) => {
    push(
      marqueeConfirmLevel({
        id: `confirm-revoke-${device.id}`,
        title: `Revoke ${device.name}?`,
        confirmLabel: "Revoke",
        danger: true,
        action: { type: "revoke_device", id: device.id },
        onConfirmed: () =>
          setRehome({ removed: device.id, previous: devices[index - 1]?.id ?? null }),
        body: "The device's token stops working immediately. Every other paired device keeps working.",
      }),
    );
  };

  return (
    <div
      ref={paneRef}
      className="mq-settings-pane-inner"
      data-testid="settings-pane-remote-devices"
    >
      <h2 className="mq-settings-cat-title">Remote devices</h2>

      {snapshot ? (
        <div data-testid="pairing">
          <PairingCode code={snapshot.pairingCode} address={snapshot.address} />
        </div>
      ) : (
        <p className="mq-settings-note" role="status">
          Waiting for the Host…
        </p>
      )}

      <div className="mq-settings-section">
        <h3 className="mq-settings-section-title">Paired devices</h3>
        {snapshot === null ? (
          <p className="mq-settings-note" role="status">
            Waiting for the Host…
          </p>
        ) : devices.length === 0 ? (
          <p className="mq-settings-note" data-testid="no-devices">
            No device is paired yet.
          </p>
        ) : (
          <ul
            className="mq-settings-devices"
            data-testid="devices"
            data-region="settings-devices-list"
            data-kind="branch"
            data-label="Paired devices"
          >
            {devices.map((device, index) => (
              <li
                key={device.id}
                className="mq-settings-device-item"
                data-testid={`device-${device.id}`}
                data-revoke-device={device.id}
              >
                <DeviceRow
                  name={device.name}
                  detail={formatPairedDetail(device.pairedAt)}
                  onRevoke={() => revoke(device, index)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AboutPane() {
  return (
    <div className="mq-settings-pane-inner" data-testid="settings-pane-about">
      <h2 className="mq-settings-cat-title">About/Credits</h2>

      <div className="mq-about-tmdb" data-testid="tmdb-credit">
        <img
          src={tmdbLogo}
          alt="TMDB"
          className="mq-about-tmdb-logo"
          data-testid="tmdb-logo"
        />
        <p className="mq-about-tmdb-notice" data-testid="tmdb-notice">
          {TMDB_NOTICE}
        </p>
      </div>

      <dl className="mq-facts">
        <div className="mq-facts-row">
          <dt className="mq-facts-term">streamingapp</dt>
          <dd className="mq-facts-value" data-testid="app-version">
            {versionLabel(appVersion)}
          </dd>
        </div>
      </dl>

      <div className="mq-settings-section">
        <h3 className="mq-settings-section-title">Licences</h3>
        <p className="mq-about-licence" data-testid="license-credits">
          {LICENCE}
        </p>
      </div>
    </div>
  );
}
