import { useState, type FormEvent } from "react";

import {
  addStatusText,
  catalogsOf,
  joinOrNone,
  moveTarget,
  resourcesOf,
} from "../core/addons";
import { explain, type ActionError } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { AddonManifest } from "../core/wire";
import { Button } from "../kit/Button";
import { Field } from "../kit/Field";
import {
  ADDONS_EMPTY,
  ADDON_FIELD_LABEL,
  ADDON_FIELD_PLACEHOLDER,
  ADDON_SUBMIT,
  ADDON_WAITING,
  addOutcomeAfter,
  addRequest,
  moveRequest,
  removeLevel,
} from "./addonsScreen";
import type { RemotePayload } from "./levels";

export type AddonsProps = {
  /** The Session the form and every row's Action go through. */
  session: Session;
  /** What the Host last published: the Addons, in the Host's order. */
  state: SessionState;
  /** A Remove press pushes the confirmation, and nothing is sent until it is answered. */
  push: (level: NewLevel<RemotePayload>) => string;
};

/**
 * Addons, in a hand (#209, ADR-0035 §1).
 *
 * Two parts on one screen: the manifest form, and the Host's register in its
 * own order. A pasted manifest is the one field, and a refusal leaves what was
 * pasted in place — a field is corrected, never retyped. A successful add says
 * which happened through the core's `addOutcome`: a new Addon is named, and a
 * manifest the Host already knew reads as a refresh rather than as a failed add
 * that cleared the field.
 *
 * The register is the Snapshot's Addons, each with its version and the
 * manifest's own facts. Move is two controls a row carries, disabled at either
 * end; Remove is never immediate — it pushes the confirmation B5's confirm
 * level draws, and the Action leaves only after a person answers. A refused
 * reorder says so beside its own row, not over the whole screen.
 */
export function Addons({ session, state, push }: AddonsProps) {
  const snapshot = state.snapshot;
  const addons = snapshot?.addons ?? [];

  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<ActionError | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    addon: string;
    error: ActionError;
  } | null>(null);
  const [adding, setAdding] = useState(false);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const action = addRequest(url);
    // Before the first Snapshot there is no register to compare the answer
    // against, so the screen waits rather than reading every add as a new one.
    if (!action || adding || snapshot === null) {
      return;
    }
    // The register at the moment of the press: the answer's Snapshot is read
    // against it, so a manifest the Host already knew is a refresh.
    const before = addons;
    setAddError(null);
    setStatus(null);
    setAdding(true);
    const outcome = await session.ask(action);
    setAdding(false);
    if (outcome.error) {
      // A refused manifest is something to correct, not retype.
      setAddError(outcome.error);
      return;
    }
    setUrl("");
    const read = addOutcomeAfter(before, outcome.response);
    setStatus(read ? addStatusText(read) : null);
  };

  const move = async (addon: AddonManifest, index: number, delta: -1 | 1) => {
    const action = moveRequest(addon.id, index, delta, addons.length);
    if (!action) {
      return;
    }
    setRowError(null);
    const outcome = await session.ask(action);
    if (outcome.error) {
      setRowError({ addon: addon.id, error: outcome.error });
    }
  };

  return (
    <section className="remote-addons" data-testid="remote-addons">
      <header className="remote-screen-head">
        <h1 className="remote-screen-title">Addons</h1>
        <span className="remote-screen-rule" aria-hidden="true" />
      </header>

      <div className="remote-addons-columns">
        <section className="remote-addons-add" aria-label="Add an Addon">
          <form className="remote-addons-form" onSubmit={add}>
            <Field
              id="remote-addon-url"
              label={ADDON_FIELD_LABEL}
              placeholder={ADDON_FIELD_PLACEHOLDER}
              value={url}
              onChange={setUrl}
              autoComplete="off"
              disabled={snapshot === null}
              error={addError}
              refusalTestId="remote-addon-refusal"
              trailing={
                <Button
                  type="submit"
                  variant="primary"
                  pending={adding}
                  disabled={snapshot === null || addRequest(url) === null}
                >
                  {ADDON_SUBMIT}
                </Button>
              }
            />
          </form>

          {status ? (
            <p role="status" className="remote-addons-status">
              {status}
            </p>
          ) : null}
        </section>

        <section className="remote-addons-register" aria-label="Configured Addons">
          {snapshot === null ? (
            <p className="remote-quiet">{ADDON_WAITING}</p>
          ) : addons.length === 0 ? (
            <div className="remote-empty" data-testid="remote-addons-empty">
              <h2 className="remote-empty-title">{ADDONS_EMPTY.title}</h2>
              <p className="remote-empty-body">{ADDONS_EMPTY.body}</p>
            </div>
          ) : (
            <ol className="remote-addons-list" data-testid="remote-addons-list">
              {addons.map((addon, index) => (
                <li
                  key={addon.id}
                  className="remote-addon"
                  data-testid={`addon-row-${addon.id}`}
                  data-addon-id={addon.id}
                >
                  <div className="remote-addon-head">
                    <span className="remote-addon-name">{addon.name}</span>
                    <span className="remote-addon-version">{addon.version}</span>
                  </div>

                  <dl className="remote-addon-facts">
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

                  <div className="remote-addon-actions">
                    <Button
                      variant="ghost"
                      disabled={moveTarget(index, -1, addons.length) === null}
                      onClick={() => void move(addon, index, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={moveTarget(index, 1, addons.length) === null}
                      onClick={() => void move(addon, index, 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      variant="ghost"
                      danger
                      onClick={() => push(removeLevel(addon))}
                    >
                      Remove
                    </Button>
                  </div>

                  {rowError?.addon === addon.id ? (
                    <p role="alert" className="remote-addon-refusal">
                      {explain(rowError.error)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
