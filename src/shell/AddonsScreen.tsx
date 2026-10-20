import { useEffect, useState, type FormEvent } from "react";

import type { ActionError, AddonManifest } from "../host-client";
import { useShell } from "./context";
import { confirmActionLevel } from "./ConfirmAction";
import { Button } from "./kit";
import { Refusal } from "./Refusal";
import {
  addOutcome,
  catalogsOf,
  joinOrNone,
  moveTarget,
  resourcesOf,
  type AddOutcome,
} from "./addons";
import "./addons.css";

/**
 * Addons: the manifest-URL form and the Host's configured Addons in its own
 * order (#82).
 *
 * A row says only its name and version until it is focused; focus expands it
 * in place to show the id, resources, types and Catalogs, and the three
 * controls that change the list. The manifest URL is not part of any of that:
 * it can carry an Addon's credentials, so the Host never publishes it
 * (ADR-0009). The order is the Host's too — Move up and Move down name the
 * 0-based position they want and the Snapshot the Host publishes is what the
 * list follows.
 */
export function AddonsScreen() {
  const { snapshot, ask, push } = useShell();
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<ActionError | null>(null);
  const [listError, setListError] = useState<ActionError | null>(null);
  const [addStatus, setAddStatus] = useState<AddOutcome | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /**
   * Where focus goes when the Host's next Snapshot no longer has a removed
   * Addon. The generic engine counts controls, and an expanded row is four of
   * them; the person means the Addon before the one they removed, or the Add
   * form when there was none.
   */
  const [rehome, setRehome] = useState<{ removed: string; previous: string | null } | null>(
    null,
  );

  const addons = snapshot?.addons ?? [];

  useEffect(() => {
    if (!rehome || addons.some((addon) => addon.id === rehome.removed)) {
      return;
    }
    const target = rehome.previous
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-addon-id]")).find(
          (element) => element.dataset.addonId === rehome.previous,
        )
      : document.querySelector<HTMLElement>('[data-testid="add-addon-submit"]');
    target?.focus({ preventScroll: true });
    setRehome(null);
  }, [addons, rehome]);

  const add = async (event: FormEvent) => {
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
      // The field keeps what was pasted: a refusal is something to correct,
      // not something to retype.
      setAddError(outcome.error);
      return;
    }
    // The answer's Snapshot says whether the manifest was new or one the Host
    // already knew: a re-add reconfigures that entry instead of growing the
    // list, which a cleared field would otherwise make look like a failure.
    setAddStatus(
      addOutcome(before, outcome.response?.snapshots.at(-1)?.addons ?? null),
    );
    setUrl("");
  };

  const move = async (addon: AddonManifest, index: number, delta: -1 | 1) => {
    const position = moveTarget(index, delta, addons.length);
    if (position === null) {
      return;
    }
    setListError(null);
    const outcome = await ask({ type: "reorder_addon", id: addon.id, position });
    if (outcome.error) {
      setListError(outcome.error);
    }
  };

  const remove = (addon: AddonManifest, index: number) => {
    push(
      confirmActionLevel({
        id: `confirm-remove-${addon.id}`,
        title: `Remove ${addon.name}?`,
        confirmLabel: "Remove",
        testId: `confirm-remove-${addon.id}`,
        action: { type: "remove_addon", id: addon.id },
        onConfirmed: () =>
          setRehome({ removed: addon.id, previous: addons[index - 1]?.id ?? null }),
        children: (
          <p>
            The Host stops asking this Addon for Catalogs, Meta previews and Streams.
            {addon.catalogs.length > 0
              ? " Its rows leave Home, and anything it was the Featured catalog for stops being featured."
              : null}{" "}
            Watch progress already recorded stays in Continue watching.
          </p>
        ),
      }),
    );
  };

  return (
    <section className="addons-screen" data-testid="addons-screen">
      <header className="addons-head">
        <h1 className="shell-screen-title">Addons</h1>
        <p className="shell-lede">
          An Addon's manifest URL adds it. The Host fetches and reads the manifest,
          keeps the Addon, and Home's Catalog rows follow your order.
        </p>
      </header>

      <form
        className="addons-add"
        data-region="addons-add"
        data-kind="row"
        data-label="Add an Addon"
        onSubmit={add}
      >
        <div className="shell-field">
          <label htmlFor="addons-manifest-url">Addon manifest URL</label>
          <input
            id="addons-manifest-url"
            placeholder="https://example.com/manifest.json"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            data-focusable
          />
        </div>
        <Button type="submit" variant="primary" disabled={adding} data-testid="add-addon-submit">
          Add
        </Button>
        <Refusal error={addError} testId="add-addon-error" />
      </form>

      {addStatus ? (
        <p className="addons-status" role="status" data-testid="add-addon-status">
          {addStatus.kind === "added"
            ? `${addStatus.name} was added.`
            : addStatus.name
              ? `That manifest is already configured as ${addStatus.name}; the Host refreshed that Addon instead of adding a second one.`
              : "That manifest is already configured; the Host refreshed that Addon instead of adding a second one."}
        </p>
      ) : null}

      {snapshot === null ? (
        <p className="shell-note">Waiting for the Host…</p>
      ) : addons.length === 0 ? (
        <p className="shell-note" data-testid="addons-empty">
          No Addons are configured yet. Paste an Addon's manifest URL above to add
          the first one.
        </p>
      ) : (
        <ul
          className="addons-list"
          data-testid="addons"
          data-region="addons-list"
          data-kind="row"
          data-label="Configured Addons"
        >
          {addons.map((addon, index) => {
            const open = expanded === addon.id;
            return (
              <li
                key={addon.id}
                className="addons-row"
                data-testid={`addon-${addon.id}`}
                data-expanded={open ? "true" : undefined}
                onFocus={() => setExpanded(addon.id)}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (next instanceof Node && event.currentTarget.contains(next)) {
                    return;
                  }
                  // Focus moving into a pushed level is the confirmation this
                  // row opened: the row stays expanded so Back returns to the
                  // exact control that asked, not to a summary that replaced it.
                  if (next instanceof Element && next.closest(".shell-level")) {
                    return;
                  }
                  setExpanded((held) => (held === addon.id ? null : held));
                }}
              >
                <button
                  type="button"
                  className="addons-summary kit-focus-lift"
                  data-focusable
                  data-testid={`addon-summary-${addon.id}`}
                  data-addon-id={addon.id}
                  aria-expanded={open}
                  onClick={() => setExpanded(addon.id)}
                >
                  <span className="addons-name">{addon.name}</span>
                  <span className="addons-version">{addon.version}</span>
                </button>

                {open ? (
                  <div className="addons-details" data-testid={`addon-details-${addon.id}`}>
                    <dl className="addons-facts">
                      <div>
                        <dt>Id</dt>
                        <dd>{addon.id}</dd>
                      </div>
                      <div>
                        <dt>Resources</dt>
                        <dd>{resourcesOf(addon)}</dd>
                      </div>
                      <div>
                        <dt>Types</dt>
                        <dd>{joinOrNone(addon.types)}</dd>
                      </div>
                      <div>
                        <dt>Catalogs</dt>
                        <dd>{catalogsOf(addon)}</dd>
                      </div>
                    </dl>

                    <div className="addons-controls">
                      <Button
                        disabled={moveTarget(index, -1, addons.length) === null}
                        onClick={() => void move(addon, index, -1)}
                      >
                        Move up
                      </Button>
                      <Button
                        disabled={moveTarget(index, 1, addons.length) === null}
                        onClick={() => void move(addon, index, 1)}
                      >
                        Move down
                      </Button>
                      <Button danger onClick={() => remove(addon, index)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Refusal error={listError} testId="addons-list-error" />
    </section>
  );
}
