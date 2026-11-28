import { useState, type FormEvent } from "react";

import { addStatusText } from "../core/addons";
import { explain, type ActionError } from "../core/errors";
import {
  addonDetailsFacts,
  addonReorderTarget,
  addonServesSummary,
  addonsCountSubtitle,
} from "../core/marqueeAddons";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { AddonManifest } from "../core/wire";
import { EmptyState } from "../kit/EmptyState";
import { GroupLabel } from "../kit/GroupLabel";
import { TextField } from "../kit/TextField";
import { PhoneAddonRow } from "../kit/phone/PhoneAddonRow";
import { PhoneHeader } from "../kit/phone/PhoneHeader";
import { PhoneSwitchRow } from "../kit/phone/PhoneSwitchRow";
import { PhoneButton, PhoneIconButton } from "../kit/phone/controls";
import {
  ADDONS_EMPTY,
  ADDON_FIELD_LABEL,
  ADDON_SUBMIT,
  ADDON_WAITING,
  addOutcomeAfter,
  addRequest,
  removeLevel,
} from "./addonsScreen";
import type { RemotePayload } from "./levels";

export type AddonsProps = {
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
};

export function Addons({ session, state, push }: AddonsProps) {
  const snapshot = state.snapshot;
  const addons = snapshot?.addons ?? [];

  const [url, setUrl] = useState("");
  const [addError, setAddError] = useState<ActionError | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busyAddon, setBusyAddon] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ addon: string; error: ActionError } | null>(
    null,
  );

  const submitAdd = async () => {
    const action = addRequest(url);
    if (!action || adding || snapshot === null) {
      return;
    }
    const before = addons;
    setAddError(null);
    setStatus(null);
    setAdding(true);
    const outcome = await session.ask(action);
    setAdding(false);
    if (outcome.error) {
      setAddError(outcome.error);
      return;
    }
    setUrl("");
    const outcomeKind = addOutcomeAfter(before, outcome.response);
    setStatus(outcomeKind ? addStatusText(outcomeKind) : null);
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitAdd();
  };

  const toggle = async (addon: AddonManifest, enabled: boolean) => {
    setRowError(null);
    setBusyAddon(addon.id);
    const outcome = await session.ask({
      type: "set_addon_enabled",
      addon: addon.id,
      enabled,
    });
    setBusyAddon(null);
    if (outcome.error) {
      setRowError({ addon: addon.id, error: outcome.error });
    }
  };

  const moveTo = async (addon: AddonManifest, target: number) => {
    if (target < 0 || target >= addons.length) {
      return;
    }
    setRowError(null);
    setBusyAddon(addon.id);
    const outcome = await session.ask({
      type: "reorder_addon",
      id: addon.id,
      position: target,
    });
    setBusyAddon(null);
    if (outcome.error) {
      setRowError({ addon: addon.id, error: outcome.error });
    }
  };

  const countSubtitle = addonsCountSubtitle(addons.length);

  return (
    <section
      className="mq-remote-screen"
      aria-label="Addons"
      data-testid="remote-addons"
    >
      <header className="mq-remote-large-head">
        <div className="mq-remote-large-head-titles">
          <h1 className="mq-remote-large-title">Addons</h1>
          {snapshot !== null && countSubtitle ? (
            <p className="mq-remote-large-subtitle">{countSubtitle}</p>
          ) : null}
        </div>
        {snapshot !== null && addons.length > 0 ? (
          <button
            type="button"
            className="mq-remote-head-action"
            data-testid="addons-edit-toggle"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </header>

      {snapshot === null ? (
        <p className="mq-remote-waiting" role="status">
          {ADDON_WAITING}
        </p>
      ) : (
        <div className="mq-remote-body">
          <form className="mq-remote-addons-form" onSubmit={onFormSubmit} noValidate>
            <TextField
              className="mq-remote-addons-field"
              label={ADDON_FIELD_LABEL}
              placeholder="Paste a manifest URL"
              type="url"
              value={url}
              onChange={setUrl}
              error={addError ? explain(addError) : null}
              disabled={adding}
            />
            <PhoneIconButton
              kind="primary"
              icon="plus"
              label={ADDON_SUBMIT}
              className="mq-remote-addons-submit"
              disabled={adding}
              onClick={() => void submitAdd()}
            />
          </form>

          {status ? (
            <p role="status" className="mq-remote-inline-status">
              {status}
            </p>
          ) : null}

          {addons.length === 0 ? (
            <div data-testid="addons-empty">
              <EmptyState
                icon="puzzle"
                title={ADDONS_EMPTY.title}
                body={ADDONS_EMPTY.body}
              />
            </div>
          ) : (
            <>
              <div className="mq-remote-addons-list" data-testid="addons-list">
                {addons.map((addon, index) => (
                  <div key={addon.id} data-testid={`addon-${addon.id}`}>
                    {editing ? (
                      <PhoneAddonRow
                        editing
                        name={addon.name}
                        summary={addonServesSummary(addon)}
                        index={index}
                        count={addons.length}
                        disabled={busyAddon === addon.id}
                        onRemove={() => push(removeLevel(addon))}
                        onMove={(target) => void moveTo(addon, target)}
                      />
                    ) : (
                      <PhoneAddonRow
                        name={addon.name}
                        summary={addonServesSummary(addon)}
                        enabled={addon.enabled}
                        disabled={busyAddon === addon.id}
                        onToggle={(next) => void toggle(addon, next)}
                        onOpen={() =>
                          push({
                            name: addon.name,
                            kind: "overlay",
                            payload: { kind: "addon-details", addonId: addon.id },
                          })
                        }
                      />
                    )}
                    {rowError?.addon === addon.id ? (
                      <p role="alert" className="mq-remote-inline-error">
                        {explain(rowError.error)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              {editing ? (
                <p className="mq-remote-addons-hint">
                  Drag handles or use arrow keys to reorder. Tap minus to remove.
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function AddonDetails({
  addonId,
  session,
  state,
  push,
  pop,
}: {
  addonId: string;
  session: Session;
  state: SessionState;
  push: (level: NewLevel<RemotePayload>) => string;
  pop: () => void;
}) {
  const addons = state.snapshot?.addons ?? [];
  const addon = addons.find((item) => item.id === addonId) ?? null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  if (!addon) {
    return (
      <section className="mq-remote-screen" aria-label="Addon">
        <PhoneHeader title="Addon" onBack={pop} />
        <EmptyState
          icon="puzzle"
          title="Addon removed"
          body="This Addon is no longer installed on your Host."
          action={{ label: "Back to Addons", onPress: pop }}
        />
      </section>
    );
  }

  const facts = addonDetailsFacts(addon);
  const upTarget = addonReorderTarget(addons, addon.id, -1);
  const downTarget = addonReorderTarget(addons, addon.id, 1);

  const toggle = async (enabled: boolean) => {
    setError(null);
    setBusy(true);
    const outcome = await session.ask({
      type: "set_addon_enabled",
      addon: addon.id,
      enabled,
    });
    setBusy(false);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  const move = async (target: number | null) => {
    if (target === null) {
      return;
    }
    setError(null);
    setBusy(true);
    const outcome = await session.ask({
      type: "reorder_addon",
      id: addon.id,
      position: target,
    });
    setBusy(false);
    if (outcome.error) {
      setError(outcome.error);
    }
  };

  return (
    <section
      className="mq-remote-screen"
      aria-label={addon.name}
      data-testid="remote-addon-details"
    >
      <PhoneHeader title={addon.name} subtitle="Addon" onBack={pop} />

      <div className="mq-remote-body">
        <div className="mq-remote-addon-card">
          <p className="mq-remote-large-subtitle">{addonServesSummary(addon)}</p>
          <PhoneSwitchRow
            label="Enabled"
            checked={addon.enabled}
            disabled={busy}
            onChange={(next) => void toggle(next)}
          />
        </div>

        <GroupLabel>Manifest</GroupLabel>
        <div className="mq-remote-facts-card" data-testid="addon-details-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="mq-remote-fact-row">
              <span className="mq-remote-fact-label">{fact.label}</span>
              <span className="mq-remote-fact-value">{fact.value}</span>
            </div>
          ))}
        </div>

        <GroupLabel>Order</GroupLabel>
        <div className="mq-remote-addon-order">
          <PhoneButton
            kind="secondary"
            icon="arrow-up"
            disabled={busy || upTarget === null}
            onClick={() => void move(upTarget)}
          >
            Move up
          </PhoneButton>
          <PhoneButton
            kind="secondary"
            icon="arrow-down"
            disabled={busy || downTarget === null}
            onClick={() => void move(downTarget)}
          >
            Move down
          </PhoneButton>
        </div>

        {error ? (
          <p role="alert" className="mq-remote-inline-error">
            {explain(error)}
          </p>
        ) : null}

        <PhoneButton
          kind="danger"
          icon="trash"
          disabled={busy}
          onClick={() => push(removeLevel(addon))}
        >
          Remove
        </PhoneButton>
      </div>
    </section>
  );
}
