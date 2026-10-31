import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AddonManifest } from "../../core/wire";
import type { ActionError } from "../../core/errors";
import { useShell } from "../context";
import { confirmActionLevel } from "../ConfirmAction";
import { Button } from "../../kit/Button";
import { focusAndReveal } from "../reveal";
import {
  addOutcome,
  addStatusText,
  catalogsOf,
  joinOrNone,
  moveTarget,
  resourcesOf,
  type AddOutcome,
} from "../../core/addons";
import { quick } from "../../core/react/motion";
import {
  LogEmpty,
  LogHead,
  LogNote,
  LogPreviewNote,
  LogRefusal,
  LogSectionHead,
} from "./RepertoryLog";

/**
 * Addons as the booth's register (#147, built #157).
 *
 * The screen is two columns on one fitted page: the manifest form on the left,
 * the Host's Addons in its own order on the right. A row expands in place on
 * focus with the layout spring — focus stays on the row while the register
 * moves — the Move controls name a 0-based position, and Remove asks first. The
 * manifest URL is never drawn — it can carry the Addon's credentials
 * (ADR-0009).
 */
export function RepertoryAddonsScreen() {
  const { snapshot, ask, push } = useShell();
  const screenRef = useRef<HTMLElement | null>(null);
  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<ActionError | null>(null);
  const [listError, setListError] = useState<{
    addon: string;
    error: ActionError;
  } | null>(null);
  const [addStatus, setAddStatus] = useState<AddOutcome | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rehome, setRehome] = useState<{ removed: string; previous: string | null } | null>(
    null,
  );

  const addons = snapshot?.addons ?? [];

  useEffect(() => {
    if (!rehome || addons.some((addon) => addon.id === rehome.removed)) {
      return;
    }
    const root = screenRef.current;
    const target = rehome.previous
      ? Array.from(root?.querySelectorAll<HTMLElement>("[data-addon-id]") ?? []).find(
          (element) => element.dataset.addonId === rehome.previous,
        )
      : root?.querySelector<HTMLElement>('[data-testid="add-addon-submit"]');
    focusAndReveal(target ?? null);
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
      // A refused manifest is something to correct, not retype.
      setAddError(outcome.error);
      return;
    }
    setAddStatus(addOutcome(before, outcome.response?.snapshots.at(-1)?.addons ?? null));
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
      setListError({ addon: addon.id, error: outcome.error });
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
    <section
      ref={screenRef}
      className="rep-log rep-log--addons"
      data-testid="addons-screen"
      data-region="addons"
      data-kind="branch"
      data-label="Addons"
    >
      <LogHead title="Addons" />

      <div className="rep-addons-columns">
        <section
          className="rep-addons-column rep-addons-column--add"
          data-region="addons-add"
          data-kind="branch"
          data-label="Add an Addon"
        >
          <LogSectionHead title="Add an Addon" />

          <form
            className="rep-addons-form"
            data-region="addons-add-form"
            data-kind="row"
            data-label="Add an Addon"
            onSubmit={add}
          >
            <div className="rep-log-field">
              <label htmlFor="addons-manifest-url">Addon manifest URL</label>
              <input
                id="addons-manifest-url"
                className="rep-log-input"
                placeholder="https://example.com/manifest.json"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                data-focusable
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              pending={adding}
              data-testid="add-addon-submit"
            >
              Add
            </Button>
            <LogRefusal error={addError} testId="add-addon-error" />
          </form>

          {addStatus ? (
            <p className="rep-log-status" role="status" data-testid="add-addon-status">
              <span className="rep-log-status-mark">Logged</span>
              <span>{addStatusText(addStatus)}</span>
            </p>
          ) : null}

          <LogPreviewNote>
            Preview data: the register is local; adding fetches the real manifest.
          </LogPreviewNote>
        </section>

        <section
          className="rep-addons-column"
          data-region="addons-register"
          data-kind="branch"
          data-label="Configured Addons"
        >
          <LogSectionHead title="Configured Addons" />

          <div className="rep-addons-scroll">
            {snapshot === null ? (
              <LogNote>Waiting for the Host…</LogNote>
            ) : addons.length === 0 ? (
              <LogEmpty
                testId="addons-empty"
                title="The register is empty."
                body="No Addons are configured yet. Paste an Addon's manifest URL above to add the first one."
              />
            ) : (
              <ul
                className="rep-log-list"
                data-testid="addons"
                data-region="addons-list"
                data-kind="branch"
                data-label="Configured Addons"
              >
                {addons.map((addon, index) => {
                  const open = expanded === addon.id;
                  return (
                    <motion.li
                      key={addon.id}
                      layout
                      transition={quick()}
                      className="rep-log-row"
                      data-testid={`addon-${addon.id}`}
                      data-expanded={open ? "true" : undefined}
                      onFocus={() => setExpanded(addon.id)}
                      onBlur={(event) => {
                        const next = event.relatedTarget;
                        if (next instanceof Node && event.currentTarget.contains(next)) {
                          return;
                        }
                        // Focus moving into a pushed level is the confirmation
                        // this row opened: Back must return to the row that asked.
                        if (next instanceof Element && next.closest(".shell-level")) {
                          return;
                        }
                        setExpanded((held) => (held === addon.id ? null : held));
                      }}
                    >
                      <button
                        type="button"
                        className="rep-log-addon-summary"
                        data-focusable
                        data-testid={`addon-summary-${addon.id}`}
                        data-addon-id={addon.id}
                        aria-expanded={open}
                        onClick={() => setExpanded(addon.id)}
                      >
                        <span className="rep-log-addon-name">{addon.name}</span>
                        <span className="rep-log-addon-version">{addon.version}</span>
                        <span className="rep-log-row-mark">Details</span>
                      </button>

                      {open ? (
                        <div
                          className="rep-log-addon-details"
                          data-testid={`addon-details-${addon.id}`}
                          data-region={`addon-details:${addon.id}`}
                          data-kind="branch"
                          data-label={`${addon.name} details`}
                        >
                          <dl className="rep-addon-facts">
                            <div>
                              <dt>Id</dt>
                              <dd>{addon.id}</dd>
                            </div>
                            <div>
                              <dt>Catalogs</dt>
                              <dd>{catalogsOf(addon)}</dd>
                            </div>
                            <div>
                              <dt>Resources</dt>
                              <dd>{resourcesOf(addon)}</dd>
                            </div>
                            <div>
                              <dt>Types</dt>
                              <dd>{joinOrNone(addon.types)}</dd>
                            </div>
                          </dl>

                          <div className="rep-log-actions">
                            <Button
                              variant="ghost"
                              className="rep-log-action"
                              disabled={moveTarget(index, -1, addons.length) === null}
                              onClick={() => void move(addon, index, -1)}
                            >
                              Move up
                            </Button>
                            <Button
                              variant="ghost"
                              className="rep-log-action"
                              disabled={moveTarget(index, 1, addons.length) === null}
                              onClick={() => void move(addon, index, 1)}
                            >
                              Move down
                            </Button>
                            <Button
                              variant="ghost"
                              danger
                              className="rep-log-action rep-log-action--danger"
                              onClick={() => remove(addon, index)}
                            >
                              Remove
                            </Button>
                          </div>

                          {listError?.addon === addon.id ? (
                            <LogRefusal
                              error={listError.error}
                              testId="addons-list-error"
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
