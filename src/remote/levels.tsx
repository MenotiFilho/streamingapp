import type { Level, NewLevel } from "../core/navigation";
import type { MetaPreview } from "../core/wire";

/**
 * What a level on the Remote's stack carries (ADR-0035 §1).
 *
 * The stack is the core's; the payload is this client's. One kind of level — a
 * Title a card opened — carries the card's identity so the screen B6 lands can
 * ask the Host for the rest without the stack being reshaped.
 *
 * The Addon travels with it because that is what `open_title` asks by, and a
 * card knows which Addon answered its row. `addon: null` is the other case: a
 * Discovered Title, which TMDB named before any Addon did — a Discover card and
 * a keyed Search hit carry no Addon, and B6 opens those against TMDB (#207,
 * ADR-0020).
 */
export type RemoteTitle = {
  /** The Addon whose Catalog answered, or null for a Discovered Title. */
  addon: string | null;
  id: string;
  type: string;
  name: string;
};

/** One level's contents, as the Remote holds them. */
export type RemotePayload = { kind: "title"; title: RemoteTitle };

/**
 * The level a press on a card pushes: an overlay above the destination, named
 * as the window names it. A Continue watching card pushes the same level,
 * because what it opens is the Title; resuming the Host's Video is B8 and B9's.
 */
export function titleLevel(title: RemoteTitle): NewLevel<RemotePayload> {
  return { name: "Title", kind: "overlay", payload: { kind: "title", title } };
}

/**
 * The same level, from the card that was pressed: its identity, and the Addon
 * that answered where one did. A Discover or keyed-Search card names no Addon,
 * because TMDB named the Title before any Addon did (#207).
 */
export function titleLevelOf(
  addon: string | null,
  meta: Pick<MetaPreview, "id" | "type" | "name">,
): NewLevel<RemotePayload> {
  return titleLevel({ addon, id: meta.id, type: meta.type, name: meta.name });
}

/**
 * The top level, drawn. There is one kind today, and this switch is where B6
 * puts the Title screen without touching the stack.
 */
export function RemoteLevel({ level }: { level: Level<RemotePayload> }) {
  switch (level.payload.kind) {
    case "title":
      return <TitlePlaceholder title={level.payload.title} />;
  }
}

/**
 * The Title until B6 draws it: the card's name, and whose screen it is. B2
 * pushes a real level so Back, the history sentinel and the stack's shape are
 * already the ones the screen will use.
 */
function TitlePlaceholder({ title }: { title: RemoteTitle }) {
  return (
    <section className="remote-level" aria-label="Title" data-testid="remote-title">
      <h2 className="remote-level-title">{title.name}</h2>
      <p className="remote-level-note">The Title screen lands in B6.</p>
    </section>
  );
}
