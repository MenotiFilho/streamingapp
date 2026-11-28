import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { catalogKey, declaredCatalogs, keyOf } from "../core/browse";
import type { Destination } from "../core/destinations";
import { explain } from "../core/errors";
import { addonLabel, continueArt, featuredRow } from "../core/home";
import {
  HOME_RAIL_ITEMS,
  MARQUEE_HERO_SLIDES,
  heroDisplayFor,
  heroWatchIntent,
  marqueeHomeEmptyState,
  wideCardNote,
} from "../core/homeHero";
import {
  FEATURE_CLOCK_MS,
  FEATURE_START,
  clampItem,
  featureElapse,
  featureProgress,
  featureStepThrough,
  type FeatureProgramme,
} from "../core/homeProgramme";
import { cardName, progressOf, resumable } from "../core/library";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { ContinueEntry, MetaPreview } from "../core/wire";
import { BrandMark } from "../kit/marquee/BrandMark";
import { EmptyState } from "../kit/marquee/EmptyState";
import { PhoneAddonNotice } from "../kit/marquee/phone/PhoneAddonNotice";
import { PhoneCardCaption } from "../kit/marquee/phone/PhoneCardCaption";
import { PhoneHero } from "../kit/marquee/phone/PhoneHero";
import { PhonePoster } from "../kit/marquee/phone/PhonePoster";
import { PhoneRowHeader } from "../kit/marquee/phone/PhoneRowHeader";
import { PhoneWideCard } from "../kit/marquee/phone/PhoneWideCard";
import { titleLevel, titleLevelOf, type RemotePayload } from "./levels";

export type HomeProps = {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  choose: (destination: Destination) => void;
};

const COMPACT_SCROLL_THRESHOLD = 420;

export function Home({ session, state, push, choose }: HomeProps) {
  const snapshot = state.snapshot;
  const { rows, answered } = useSyncExternalStore(
    session.home.subscribe,
    session.home.getSnapshot,
  );
  const [programme, setProgramme] = useState<FeatureProgramme>(FEATURE_START);
  const [compact, setCompact] = useState(false);

  const catalogs = useMemo(() => declaredCatalogs(snapshot), [snapshot]);
  const catalogFingerprint = useMemo(
    () => catalogs.map((catalog) => catalogKey(catalog)).join("|"),
    [catalogs],
  );
  const declaredKeys = useMemo(
    () => new Set(catalogs.map((catalog) => catalogKey(catalog))),
    [catalogs],
  );
  const visibleRows = useMemo(
    () => rows.filter((row) => declaredKeys.has(keyOf(row))),
    [declaredKeys, rows],
  );

  const featuredCatalog = snapshot?.featuredCatalog;
  const featuredKey = featuredCatalog
    ? keyOf({
        addon: featuredCatalog.addon,
        type: featuredCatalog.catalog.type,
        id: featuredCatalog.catalog.id,
      })
    : null;

  useEffect(() => {
    session.home.enter();
  }, [session]);

  useEffect(() => {
    session.home.sync(declaredCatalogs(snapshot), featuredKey);
  }, [session, catalogFingerprint, featuredKey, snapshot]);

  useEffect(() => {
    const onScroll = () => {
      setCompact(window.scrollY >= COMPACT_SCROLL_THRESHOLD);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const featured = useMemo(() => featuredRow(snapshot, visibleRows), [snapshot, visibleRows]);
  const featuredMetas = useMemo(
    () => (featured?.metas ?? []).slice(0, MARQUEE_HERO_SLIDES),
    [featured],
  );

  useEffect(() => {
    setProgramme(FEATURE_START);
  }, [featuredKey, featuredMetas[0]?.id]);

  const rotating = featuredMetas.length > 1;
  useEffect(() => {
    if (!rotating) {
      return;
    }
    const timer = window.setInterval(() => {
      setProgramme((current) =>
        featureElapse(current, featuredMetas.length, FEATURE_CLOCK_MS),
      );
    }, FEATURE_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [featuredMetas.length, rotating]);

  const activeIndex = clampItem(programme.index, featuredMetas.length);
  const rotatingItem = featuredMetas[activeIndex] ?? null;
  const heroDisplay = useMemo(
    () =>
      heroDisplayFor({
        mode: "rotating",
        rotatingItem,
        target: null,
        continueWatching: snapshot?.continueWatching ?? [],
        rows: visibleRows,
      }),
    [rotatingItem, snapshot?.continueWatching, visibleRows],
  );
  const elapsed = featureProgress(programme);

  const watchedFilmKeys = useMemo(() => {
    const set = new Set<string>();
    for (const entry of snapshot?.watchProgress ?? []) {
      if (entry.watched && entry.title.type === "movie") {
        set.add(`${entry.title.type}:${entry.title.id}`);
      }
    }
    return set;
  }, [snapshot?.watchProgress]);

  const continueWatching = snapshot?.continueWatching ?? [];
  const empty = marqueeHomeEmptyState(snapshot, catalogs.length);

  const openContinue = (entry: ContinueEntry) => {
    push(
      titleLevel({
        addon: entry.title.addon,
        id: entry.title.id,
        type: entry.title.type,
        name: entry.title.name,
      }),
    );
  };

  const openMeta = (addon: string, meta: MetaPreview) => {
    push(titleLevelOf(addon, meta));
  };

  const heroFacts = useMemo(() => {
    const meta = heroDisplay?.meta;
    if (!meta) {
      return [];
    }
    return [
      meta.rating ? `IMDb ${meta.rating}` : null,
      meta.year,
      meta.runtime,
      ...meta.genres.slice(0, 2),
    ].filter((item): item is string => Boolean(item));
  }, [heroDisplay]);

  return (
    <section
      className="mq-remote-home"
      aria-label="Home"
      data-testid="remote-home"
    >
      <h1 className="mq-remote-visually-hidden">Home</h1>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          Waiting for the Host…
        </p>
      ) : (
        <>
          {heroDisplay && featured && rotatingItem ? (
            <>
              <header
                className="mq-remote-home-sticky"
                data-compact={compact ? "true" : "false"}
                aria-hidden={!compact || undefined}
              >
                <BrandMark />
                <span className="mq-remote-home-sticky-title">Home</span>
              </header>

              <div className="mq-remote-home-hero-wrap" data-testid="remote-home-hero">
                <div className="mq-remote-home-brand">
                  <BrandMark />
                </div>
                <PhoneHero
                  itemKey={heroDisplay.titleKey}
                  name={heroDisplay.name}
                  backdrop={heroDisplay.backdrop ?? heroDisplay.poster}
                  logo={heroDisplay.logo}
                  facts={heroFacts}
                  index={activeIndex}
                  count={featuredMetas.length}
                  elapsed={elapsed}
                  onWatch={() => {
                    const intent = heroWatchIntent(
                      rotatingItem,
                      featured.addon,
                      continueWatching,
                    );
                    if (intent.kind === "resume") {
                      void session.take(intent.action);
                    } else {
                      push(titleLevelOf(intent.addon, intent.preview));
                    }
                  }}
                  onDetails={() => openMeta(featured.addon, rotatingItem)}
                  onSwipe={(step) =>
                    setProgramme((current) =>
                      featureStepThrough(
                        current,
                        featuredMetas.length,
                        step === "next" ? 1 : -1,
                      ),
                    )
                  }
                />
              </div>
            </>
          ) : (
            <header className="mq-remote-large-head">
              <div className="mq-remote-large-head-titles">
                <BrandMark />
              </div>
            </header>
          )}

          {continueWatching.length > 0 ? (
            <section
              className="mq-remote-row"
              aria-label="Continue watching"
              data-testid="remote-continue"
            >
              <div className="mq-remote-row-head">
                <PhoneRowHeader title="Continue watching" />
              </div>
              <div className="mq-remote-track mq-remote-track--wide">
                {continueWatching.map((entry) => {
                  const playable = resumable(entry);
                  return (
                    <div
                      key={`${entry.title.type}/${entry.video.id}`}
                      className="mq-remote-wide-slot"
                      data-unplayable={!playable || undefined}
                    >
                      <PhoneWideCard
                        name={cardName(entry)}
                        art={continueArt(entry)}
                        logo={entry.title.logo}
                        upNext={entry.upNext}
                        progress={progressOf(entry)}
                        disabled={!playable}
                        testId={`resume-${entry.video.id}`}
                        onPress={() => openContinue(entry)}
                      />
                      <PhoneCardCaption
                        title={cardName(entry)}
                        note={wideCardNote(entry)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {empty ? (
            <div data-testid="remote-empty">
              <EmptyState
                icon="puzzle"
                title={empty.title}
                body={empty.body}
                action={{ label: "Open Addons", onPress: () => choose("addons") }}
              />
            </div>
          ) : null}

          {visibleRows.map((row) => {
            const rowKey = keyOf(row);
            const failure = row.failure;
            const source = addonLabel(snapshot, row.addon);
            const items = row.metas.slice(0, HOME_RAIL_ITEMS);
            const isAnswered = answered.has(rowKey);

            return (
              <section
                key={rowKey}
                className="mq-remote-row"
                data-testid={`remote-row-${rowKey}`}
              >
                <div className="mq-remote-row-head">
                  <PhoneRowHeader title={row.name} source={source} />
                </div>

                {items.length > 0 ? (
                  <div className="mq-remote-track">
                    {items.map((meta) => {
                      const watched = watchedFilmKeys.has(`${meta.type}:${meta.id}`);
                      const unplayable = state.unplayable.has(meta.id);
                      return (
                        <div
                          key={meta.id}
                          className="mq-remote-poster-slot"
                          data-watched={watched || undefined}
                          data-unplayable={unplayable || undefined}
                        >
                          <PhonePoster
                            name={meta.name}
                            poster={meta.poster}
                            testId={`card-${row.addon}-${meta.id}`}
                            onPress={() => openMeta(row.addon, meta)}
                          />
                          {unplayable ? (
                            <span className="mq-remote-poster-badge" aria-hidden="true">
                              Unplayable
                            </span>
                          ) : watched ? (
                            <span
                              className="mq-remote-poster-badge"
                              data-tone="accent"
                              aria-hidden="true"
                            >
                              Watched
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {failure ? (
                  <div className="mq-remote-row-notice">
                    <PhoneAddonNotice
                      title={row.name}
                      reason={explain(failure)}
                      onRetry={() => session.home.page(rowKey)}
                    />
                  </div>
                ) : isAnswered && items.length === 0 ? (
                  <p className="mq-remote-row-note">
                    No Titles answered from this Catalog.
                  </p>
                ) : null}
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
