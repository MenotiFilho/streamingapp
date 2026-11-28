import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  addOutcome,
  addStatusText,
  moveTarget,
  type AddOutcome,
} from "../../core/addons";
import { explain, type ActionError } from "../../core/errors";
import {
  addonDetailsFacts,
  addonMovingIntent,
  addonRemoveBody,
  addonServesSummary,
  addonsCountSubtitle,
} from "../../core/marqueeAddons";
import type { AddonManifest } from "../../core/wire";
import { AddonRow } from "../../kit/marquee/AddonRow";
import { Button } from "../../kit/marquee/Button";
import { EmptyState } from "../../kit/marquee/EmptyState";
import { ScreenTitle } from "../../kit/marquee/ScreenTitle";
import { TextField } from "../../kit/marquee/TextField";
import { useShell } from "../context";
import { focusAndReveal } from "../reveal";
import { marqueeConfirmLevel } from "./MarqueeConfirm";
import "./marqueeSettingsAddons.css";

/**
 * Marquee Addons (`18.jpg`–`18d.jpg`, `docs/design-system.md` §8, ADR-0044 §1–§2):
 * - Install an Addon by manifest URL (URL kept secret per ADR-0009).
 * - Per-Addon enable/disable Switch (`set_addon_enabled`).
 * - Inline Details facts from `Manifest` only (Version, Id, Serves, Types,
 *   Catalogs; never URL, origin, or OFFLINE probe).
 * - Moving mode with Move up / Move down (`reorder_addon`), arrows and OK to place.
 * - Remove through a `Confirm` level whose focus starts on Cancel.
 */
export function MarqueeAddons() {
  const { snapshot, ask, push, setBaseIntentHandler } = useShell();
  const screenRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<ActionError | null>(null);
  const [addStatus, setAddStatus] = useState<AddOutcome | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [listError, setListError] = useState<{ addon: string; error: ActionError } | null>(
    null,
  );
  const [rehome, setRehome] = useState<{ removed: string; previous: string | null } | null>(
    null,
  );

  const addons = snapshot?.addons ?? [];
  const addonsRef = useRef(addons);
  addonsRef.current = addons;

  useEffect(() => {
    if (movingId && !addons.some((addon) => addon.id === movingId)) {
      setMovingId(null);
    }
    if (detailsId && !addons.some((addon) => addon.id === detailsId)) {
      setDetailsId(null);
    }
  }, [addons, detailsId, movingId]);

  useEffect(() => {
    if (!rehome || addons.some((addon) => addon.id === rehome.removed)) {
      return;
    }
    const root = screenRef.current;
    const target = rehome.previous
      ? Array.from(root?.querySelectorAll<HTMLElement>("[data-addon-id] button.mq-c7-row-main") ?? []).find(
          (element) => element.closest<HTMLElement>("[data-addon-id]")?.dataset.addonId === rehome.previous,
        )
      : root?.querySelector<HTMLElement>('[data-testid="add-addon-submit"]');
    focusAndReveal(target ?? inputRef.current);
    setRehome(null);
  }, [addons, rehome]);

  const install = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || adding) {
      return;
    }
    setAddError(null);
    setAddStatus(null);
    setAdding(true);
    const before = addons;
    const outcome = await ask({ type: "add_addon", url: trimmed });
    setAdding(false);
    if (outcome.error) {
      setAddError(outcome.error);
      return;
    }
    setAddStatus(addOutcome(before, outcome.response?.snapshots.at(-1)?.addons ?? null));
    setUrl("");
  };

  const toggleEnabled = async (addon: AddonManifest, enabled: boolean) => {
    setListError(null);
    const outcome = await ask({
      type: "set_addon_enabled",
      addon: addon.id,
      enabled,
    });
    if (outcome.error) {
      setListError({ addon: addon.id, error: outcome.error });
    }
  };

  const move = useCallback(
    async (addon: AddonManifest, index: number, delta: -1 | 1) => {
      const position = moveTarget(index, delta, addonsRef.current.length);
      if (position === null) {
        return;
      }
      setListError(null);
      setDetailsId(null);
      setMovingId(addon.id);
      const outcome = await ask({ type: "reorder_addon", id: addon.id, position });
      if (outcome.error) {
        setMovingId(null);
        setListError({ addon: addon.id, error: outcome.error });
      }
    },
    [ask],
  );

  // Route gamepad / non-keyboard Up and Down intents while a row is moving.
  useEffect(() => {
    if (movingId === null) {
      return undefined;
    }
    return setBaseIntentHandler((intent) => {
      const currentAddons = addonsRef.current;
      const index = currentAddons.findIndex((addon) => addon.id === movingId);
      const movingAddon = index >= 0 ? currentAddons[index] : undefined;
      if (!movingAddon) {
        return false;
      }
      const action = addonMovingIntent(intent, {
        moving: true,
        canMoveUp: moveTarget(index, -1, currentAddons.length) !== null,
        canMoveDown: moveTarget(index, 1, currentAddons.length) !== null,
      });
      if (action === "up") {
        void move(movingAddon, index, -1);
        return true;
      }
      if (action === "down") {
        void move(movingAddon, index, 1);
        return true;
      }
      return action === "consume";
    });
  }, [move, movingId, setBaseIntentHandler]);

  const remove = (addon: AddonManifest, index: number) => {
    push(
      marqueeConfirmLevel({
        id: `confirm-remove-${addon.id}`,
        title: `Remove ${addon.name}?`,
        confirmLabel: "Remove",
        danger: true,
        action: { type: "remove_addon", id: addon.id },
        body: addonRemoveBody(addon),
        onConfirmed: () => {
          setDetailsId((held) => (held === addon.id ? null : held));
          setMovingId((held) => (held === addon.id ? null : held));
          setRehome({ removed: addon.id, previous: addons[index - 1]?.id ?? null });
        },
      }),
    );
  };

  const toggleDetails = (addonId: string) => {
    setMovingId(null);
    setDetailsId((held) => (held === addonId ? null : addonId));
  };

  const subtitle = useMemo(() => addonsCountSubtitle(addons.length), [addons.length]);

  return (
    <section
      ref={screenRef}
      className="mq-screen mq-addons-screen"
      data-testid="addons-screen"
      data-region="addons"
      data-kind="branch"
      data-label="Addons"
    >
      <ScreenTitle title="Addons" subtitle={subtitle} />

      <form
        className="mq-addons-form"
        data-region="addons-add-form"
        data-kind="row"
        data-label="Install an Addon"
        onSubmit={(event) => void install(event)}
      >
        <TextField
          ref={inputRef}
          id="addons-manifest-url"
          label="Install an Addon"
          type="url"
          placeholder="Paste a manifest URL"
          value={url}
          onChange={setUrl}
          error={addError ? explain(addError) : null}
        />
        <Button
          type="submit"
          kind="primary"
          size="lg"
          icon="plus"
          disabled={adding}
          data-testid="add-addon-submit"
          className="mq-addons-install-btn"
        >
          Install
        </Button>
      </form>

      {addStatus ? (
        <p className="mq-inline-status" role="status" data-testid="add-addon-status">
          {addStatusText(addStatus)}
        </p>
      ) : null}

      {snapshot === null ? (
        <p className="mq-addons-waiting" role="status">
          Waiting for the Host…
        </p>
      ) : addons.length === 0 ? (
        <div className="mq-addons-empty" data-testid="addons-empty">
          <EmptyState
            icon="puzzle"
            title="No Addons installed"
            body="Paste an Addon's manifest URL above to install the first one."
          />
        </div>
      ) : (
        <ul
          className="mq-addons-list"
          data-testid="addons"
          data-region="addons-list"
          data-kind="branch"
          data-label="Configured Addons"
        >
          {addons.map((addon, index) => {
            const isMoving = movingId === addon.id;
            const isDetailsOpen = detailsId === addon.id && !isMoving;
            return (
              <li
                key={addon.id}
                className="mq-addons-item"
                data-testid={`addon-${addon.id}`}
                data-addon-id={addon.id}
              >
                <AddonRow
                  name={addon.name}
                  serves={addonServesSummary(addon)}
                  version={addon.version}
                  enabled={addon.enabled}
                  moving={isMoving}
                  canMoveUp={moveTarget(index, -1, addons.length) !== null}
                  canMoveDown={moveTarget(index, 1, addons.length) !== null}
                  onToggle={(next) => void toggleEnabled(addon, next)}
                  onDetails={() => toggleDetails(addon.id)}
                  onPress={() => toggleDetails(addon.id)}
                  onMoveUp={() => void move(addon, index, -1)}
                  onMoveDown={() => void move(addon, index, 1)}
                  onPlace={() => setMovingId(null)}
                  onRemove={() => remove(addon, index)}
                />

                {isDetailsOpen ? (
                  <dl
                    className="mq-facts mq-addon-details"
                    data-testid={`addon-details-${addon.id}`}
                  >
                    {addonDetailsFacts(addon).map((fact) => (
                      <div key={fact.label} className="mq-facts-row">
                        <dt className="mq-facts-term">{fact.label}</dt>
                        <dd className="mq-facts-value">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {listError?.addon === addon.id ? (
                  <p role="alert" className="mq-inline-refusal" data-testid="addons-list-error">
                    {explain(listError.error)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
