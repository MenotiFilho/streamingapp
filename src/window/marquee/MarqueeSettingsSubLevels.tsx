import { useEffect, useState, type ReactNode } from "react";

import {
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
} from "../../core/controls";
import { explain, type ActionError } from "../../core/errors";
import { down, rows, tick, untick, up, type LanguageKind } from "../../core/languageList";
import {
  FOLLOW_THE_FILE,
  FOLLOW_THE_FILE_AUDIO_LINE,
  FOLLOW_THE_FILE_SUBTITLE_LINE,
} from "../../core/languages";
import {
  PREFERENCE_SUB_LEVELS,
  activeFeaturedKey,
  clampPreviewScale,
  featuredCatalogAction,
  featuredCatalogChoices,
  type PreferenceSubLevelId,
} from "../../core/marqueeSettings";
import { useLanguageList } from "../../core/react/useLanguageList";
import { NO_CATALOG, unknownColorLabel } from "../../core/settingsRegister";
import type { Action } from "../../core/wire";
import { Badge } from "../../kit/marquee/Badge";
import { Chip } from "../../kit/marquee/Chip";
import { GroupLabel } from "../../kit/marquee/GroupLabel";
import { IconButton } from "../../kit/marquee/IconButton";
import { ListRow } from "../../kit/marquee/ListRow";
import { RankedRow } from "../../kit/marquee/RankedRow";
import { SizeStepper } from "../../kit/marquee/SizeStepper";
import { useShell } from "../context";

function SubLevelHeader({
  crumb,
  title,
  intro,
  onBack,
  backTestId,
}: {
  crumb: string;
  title: string;
  intro: string;
  onBack: () => void;
  backTestId: string;
}) {
  return (
    <header className="mq-settings-subhead">
      <div className="mq-settings-subhead-bar">
        <IconButton
          icon="arrow-left"
          kind="glass"
          size="sm"
          label="Back"
          autoFocus
          data-testid={backTestId}
          onClick={onBack}
        />
        <div className="mq-settings-subhead-titles">
          <span className="mq-settings-crumb">{crumb}</span>
          <h2 className="mq-settings-subhead-title">{title}</h2>
        </div>
      </div>
      <p className="mq-settings-intro">{intro}</p>
    </header>
  );
}

/**
 * `23 Subtitle languages` and `23b Audio languages`:
 * Ranked chosen list (up to 3) + "Following the file" empty banner + curated
 * "Add a language" list.
 */
function LanguagesSubLevel({ kind }: { kind: LanguageKind }) {
  const { snapshot, ask, pop } = useShell();
  const meta = PREFERENCE_SUB_LEVELS[kind === "subtitle" ? "subtitle-languages" : "audio-languages"];
  const { list, error, change, current } = useLanguageList(kind, snapshot, ask);
  const view = rows(list);
  const followDetail =
    kind === "subtitle" ? FOLLOW_THE_FILE_SUBTITLE_LINE : FOLLOW_THE_FILE_AUDIO_LINE;

  return (
    <div
      className="mq-settings-pane-inner"
      data-testid={`settings-sublevel-${kind}-languages`}
    >
      <SubLevelHeader
        crumb={meta.crumb}
        title={meta.title}
        intro={meta.intro}
        onBack={pop}
        backTestId={`${meta.levelId}-back`}
      />

      {view.chosen.length === 0 ? (
        <div
          className="mq-settings-follow-banner"
          data-testid={`language-follow-${kind}`}
        >
          <span className="mq-settings-follow-title">{FOLLOW_THE_FILE}</span>
          <span className="mq-settings-follow-detail">{followDetail}</span>
        </div>
      ) : (
        <div
          className="mq-settings-group"
          data-region={`settings-${kind}-chosen`}
          data-kind="branch"
          data-label="Chosen languages"
        >
          <GroupLabel>Chosen · in order</GroupLabel>
          <div className="mq-settings-rows">
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
        <p className="mq-settings-note" data-testid="language-note">
          {view.note}
        </p>
      ) : null}

      <div
        className="mq-settings-group"
        data-region={`settings-${kind}-available`}
        data-kind="branch"
        data-label="Add a language"
      >
        <GroupLabel>Add a language</GroupLabel>
        <div className="mq-settings-rows">
          {view.rest.map((row) => (
            <ListRow
              key={row.tag}
              icon="plus"
              label={row.name}
              chevron={false}
              disabled={row.disabled}
              onPress={() => void change(tick(current(), row.tag))}
            />
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mq-inline-refusal" data-testid={`${kind}-languages-error`}>
          {explain(error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * `24 Subtitle appearance`:
 * Colour chips + 5% SizeStepper (25%–300%) + live preview frame.
 */
function SubtitleAppearanceSubLevel() {
  const { snapshot, ask, pop } = useShell();
  const meta = PREFERENCE_SUB_LEVELS["subtitle-appearance"];
  const heldColor = snapshot?.preferences.subtitleColor ?? "#FFFFFF";
  const heldScale = snapshot?.preferences.subtitleScale ?? 1;
  const [error, setError] = useState<ActionError | null>(null);
  const otherColor = unknownColorLabel(heldColor);
  const previewScale = clampPreviewScale(heldScale);

  const pickAppearance = async (action: Action) => {
    setError(null);
    const outcome = await ask(action);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  return (
    <div
      className="mq-settings-pane-inner"
      data-testid="settings-sublevel-subtitle-appearance"
    >
      <SubLevelHeader
        crumb={meta.crumb}
        title={meta.title}
        intro={meta.intro}
        onBack={pop}
        backTestId={`${meta.levelId}-back`}
      />

      <div className="mq-choice-group">
        <span className="mq-choice-label">Colour</span>
        <div
          className="mq-choice-row"
          data-region="settings-subtitle-colors"
          data-kind="row"
          data-label="Subtitle colour"
        >
          {SUBTITLE_COLORS.map((choice) => (
            <Chip
              key={choice.color}
              selected={colorSelected(heldColor, choice.color)}
              data-testid={`subtitle-color-${choice.label.toLowerCase()}`}
              onClick={() =>
                void pickAppearance({ type: "set_subtitle_color", color: choice.color })
              }
            >
              {choice.label}
            </Chip>
          ))}
          {otherColor ? (
            <Chip
              selected
              data-testid="subtitle-color-other"
              onClick={() =>
                void pickAppearance({ type: "set_subtitle_color", color: heldColor })
              }
            >
              {otherColor}
            </Chip>
          ) : null}
        </div>
      </div>

      <div className="mq-choice-group">
        <span className="mq-choice-label">Size</span>
        <div
          className="mq-stepper-row"
          data-region="settings-subtitle-size"
          data-kind="row"
          data-label="Subtitle size"
        >
          <SizeStepper
            scale={heldScale}
            onChange={(scale) => void pickAppearance({ type: "set_subtitle_scale", scale })}
          />
          <span className="mq-stepper-hint">From 25% to 300%, in steps of 5%.</span>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mq-inline-refusal" data-testid="subtitle-appearance-error">
          {explain(error)}
        </p>
      ) : null}

      <div className="mq-subtitle-preview" aria-hidden="true">
        <Badge tone="neutral" className="mq-subtitle-preview-badge">
          PREVIEW
        </Badge>
        <div className="mq-subtitle-preview-scrim" />
        <p
          className="mq-subtitle-preview-line"
          style={{
            color: heldColor,
            fontSize: `calc(var(--mq-u) * ${Math.round(30 * previewScale)})`,
          }}
        >
          Ninguém aqui sabe quem você é lá fora.
        </p>
      </div>
    </div>
  );
}

/**
 * `25 Stream buffer & torrent cache`:
 * Look-ahead + Memory ceiling chips (paired via draft composition) + Torrent cache chips.
 */
function StreamBufferSubLevel() {
  const { snapshot, ask, pop } = useShell();
  const meta = PREFERENCE_SUB_LEVELS["stream-buffer"];
  const publishedBuffer = snapshot?.preferences.streamBuffer ?? {
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
    snapshot?.preferences.torrentCache.megabytes ?? TORRENT_CACHE_DEFAULT_MEGABYTES;

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

  const pickTorrentCache = async (megabytes: number) => {
    setTorrentError(null);
    const outcome = await ask(torrentCacheRequest(megabytes));
    if (outcome.error) {
      setTorrentError(outcome.error);
    }
  };

  return (
    <div
      className="mq-settings-pane-inner"
      data-testid="settings-sublevel-stream-buffer"
    >
      <SubLevelHeader
        crumb={meta.crumb}
        title={meta.title}
        intro={meta.intro}
        onBack={pop}
        backTestId={`${meta.levelId}-back`}
      />

      <div className="mq-choice-group">
        <span className="mq-choice-label">Look-ahead</span>
        <div
          className="mq-choice-row"
          data-region="settings-buffer-seconds"
          data-kind="row"
          data-label="Stream buffer time"
        >
          {STREAM_BUFFER_SECONDS.map((choice) => (
            <Chip
              key={choice.seconds}
              selected={bufferDraft.seconds === choice.seconds}
              data-testid={`buffer-seconds-${choice.seconds}`}
              onClick={() => void pickBuffer(choice.seconds, bufferDraft.megabytes)}
            >
              {choice.label}
            </Chip>
          ))}
          {!bufferSecondsPreset(bufferDraft.seconds) ? (
            <Chip
              selected
              data-testid="buffer-seconds-other"
              onClick={() => void pickBuffer(bufferDraft.seconds, bufferDraft.megabytes)}
            >
              {formatBufferSeconds(bufferDraft.seconds)}
            </Chip>
          ) : null}
        </div>
      </div>

      <div className="mq-choice-group">
        <span className="mq-choice-label">Memory ceiling</span>
        <div
          className="mq-choice-row"
          data-region="settings-buffer-megabytes"
          data-kind="row"
          data-label="Stream buffer memory"
        >
          {STREAM_BUFFER_MEGABYTES.map((choice) => (
            <Chip
              key={choice.megabytes}
              selected={bufferDraft.megabytes === choice.megabytes}
              data-testid={`buffer-megabytes-${choice.megabytes}`}
              onClick={() => void pickBuffer(bufferDraft.seconds, choice.megabytes)}
            >
              {choice.label}
            </Chip>
          ))}
          {!bufferMegabytesPreset(bufferDraft.megabytes) ? (
            <Chip
              selected
              data-testid="buffer-megabytes-other"
              onClick={() => void pickBuffer(bufferDraft.seconds, bufferDraft.megabytes)}
            >
              {formatBufferMegabytes(bufferDraft.megabytes)}
            </Chip>
          ) : null}
        </div>
        <p className="mq-settings-note" data-testid="stream-buffer-torrents">
          {TORRENT_FETCH_NOTE}
        </p>
      </div>

      {bufferError ? (
        <p role="alert" className="mq-inline-refusal" data-testid="stream-buffer-error">
          {explain(bufferError)}
        </p>
      ) : null}

      <hr className="mq-settings-rule" />

      <div className="mq-settings-section">
        <h3 className="mq-settings-section-title">{TORRENT_CACHE_HEAD}</h3>
        <p className="mq-settings-section-body">
          The most disk a playing torrent may take. Pieces furthest behind go first, and all
          of it is deleted when the torrent is let go.
        </p>
        <div className="mq-choice-group">
          <span className="mq-choice-label">Size</span>
          <div
            className="mq-choice-row"
            data-region="settings-torrent-cache-sizes"
            data-kind="row"
            data-label="Torrent cache"
          >
            {TORRENT_CACHE_MEGABYTES.map((choice) => (
              <Chip
                key={choice.megabytes}
                selected={heldTorrentCache === choice.megabytes}
                data-testid={`torrent-cache-${choice.megabytes}`}
                onClick={() => void pickTorrentCache(choice.megabytes)}
              >
                {choice.label}
              </Chip>
            ))}
            {!torrentCachePreset(heldTorrentCache) ? (
              <Chip
                selected
                data-testid="torrent-cache-other"
                onClick={() => void pickTorrentCache(heldTorrentCache)}
              >
                {formatTorrentCache(heldTorrentCache)}
              </Chip>
            ) : null}
          </div>
        </div>
        {torrentError ? (
          <p role="alert" className="mq-inline-refusal" data-testid="torrent-cache-error">
            {explain(torrentError)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * `26 Up next & featured catalog`:
 * Autoplay switch + Up next playback chips + Featured catalog chips.
 */
function UpNextAndFeaturedSubLevel() {
  const { snapshot, ask, pop } = useShell();
  const meta = PREFERENCE_SUB_LEVELS["up-next"];
  const [upNextError, setUpNextError] = useState<ActionError | null>(null);
  const [featuredError, setFeaturedError] = useState<ActionError | null>(null);

  const autoplay = autoplayOn(snapshot);
  const upNextPlayback = snapshot?.preferences.upNextPlayback ?? "direct";
  const featuredKey = activeFeaturedKey(snapshot);
  const catalogs = featuredCatalogChoices(snapshot);

  const sendUpNext = async (action: Action) => {
    setUpNextError(null);
    const outcome = await ask(action);
    if (outcome.error) {
      setUpNextError(outcome.error);
    }
  };

  const sendFeatured = async (action: Action) => {
    setFeaturedError(null);
    const outcome = await ask(action);
    if (outcome.error) {
      setFeaturedError(outcome.error);
    }
  };

  return (
    <div
      className="mq-settings-pane-inner"
      data-testid="settings-sublevel-up-next"
    >
      <SubLevelHeader
        crumb={meta.crumb}
        title={meta.title}
        intro={meta.intro}
        onBack={pop}
        backTestId={`${meta.levelId}-back`}
      />

      <div className="mq-settings-section">
        <ListRow
          icon="skip-forward"
          label="Autoplay the next episode"
          checked={autoplay}
          onToggle={(next) => void sendUpNext({ type: "set_autoplay", autoplay: next })}
        />
        <p className="mq-settings-note">
          On, the next episode plays 5 seconds after one ends; off, the Player waits.
        </p>
      </div>

      <div className="mq-choice-group">
        <span className="mq-choice-label">When Play is pressed on an Up next</span>
        <div
          className="mq-choice-row"
          data-region="settings-up-next-playback"
          data-kind="row"
          data-label="When Play is pressed on an Up next"
        >
          {UP_NEXT_PLAYBACK_CHOICES.map((choice) => (
            <Chip
              key={choice.playback}
              selected={upNextPlayback === choice.playback}
              data-testid={`up-next-${choice.playback}`}
              onClick={() =>
                void sendUpNext({
                  type: "set_up_next_playback",
                  playback: choice.playback,
                })
              }
            >
              {choice.label}
            </Chip>
          ))}
        </div>
      </div>

      {upNextError ? (
        <p role="alert" className="mq-inline-refusal" data-testid="up-next-error">
          {explain(upNextError)}
        </p>
      ) : null}

      <hr className="mq-settings-rule" />

      <div className="mq-settings-section">
        <h3 className="mq-settings-section-title">Featured catalog</h3>
        <p className="mq-settings-section-body">
          What every client&rsquo;s Home hero is drawn from: its first titles, in the
          Addon&rsquo;s own order.
        </p>
        {snapshot !== null && catalogs.length === 0 ? (
          <p className="mq-settings-note" data-testid="featured-empty">
            {NO_CATALOG}
          </p>
        ) : null}
        <div className="mq-choice-group">
          <span className="mq-choice-label">Catalog</span>
          <div
            className="mq-choice-row"
            data-region="settings-featured"
            data-kind="row"
            data-label="Featured catalog"
          >
            <Chip
              selected={featuredKey === null}
              data-testid="featured-none"
              onClick={() => void sendFeatured(featuredCatalogAction(null))}
            >
              None
            </Chip>
            {catalogs.map((choice) => (
              <Chip
                key={choice.key}
                selected={featuredKey === choice.key}
                data-testid={`featured-${choice.key}`}
                onClick={() => void sendFeatured(featuredCatalogAction(choice.catalog))}
              >
                {choice.label}
              </Chip>
            ))}
          </div>
        </div>
        {featuredError ? (
          <p role="alert" className="mq-inline-refusal" data-testid="featured-catalog-error">
            {explain(featuredError)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Render the right-hand pane for a given Preferences sub-level id. */
export function renderPreferenceSubLevel(id: PreferenceSubLevelId): ReactNode {
  switch (id) {
    case "subtitle-languages":
      return <LanguagesSubLevel kind="subtitle" />;
    case "audio-languages":
      return <LanguagesSubLevel kind="audio" />;
    case "subtitle-appearance":
      return <SubtitleAppearanceSubLevel />;
    case "stream-buffer":
      return <StreamBufferSubLevel />;
    case "up-next":
      return <UpNextAndFeaturedSubLevel />;
  }
}
