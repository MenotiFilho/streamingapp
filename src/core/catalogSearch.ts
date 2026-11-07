/**
 * The keyless Search's answer, held for the Session (#264).
 *
 * `search_catalogs` is one Action for every searchable Catalog, so it is not a
 * paged feed and it does not use the feed store. It still belongs outside the
 * screen: the Remote unmounts Search under a Title, and Back must paint the
 * same rows without asking the same query again. An answer is kept per query —
 * one a person left cannot land in the one they are reading — and a failure is
 * the Host's words until the person asks again (ADR-0020).
 */

import { answeredCatalogs, type ActionOutcome } from "./answers";
import { asActionError, type ActionError } from "./errors";
import { SnapshotStore, sameSet, type Ask } from "./store";
import type { CatalogRow } from "./wire";

/** What one keyless query has answered so far. */
export type CatalogAnswer = {
  /** One row per Catalog that answered, or null before an answer. */
  rows: CatalogRow[] | null;
  failure: ActionError | null;
};

/** What a Search screen reads: the answers by query, and which are in flight. */
export type CatalogSearchSnapshot = {
  answers: ReadonlyMap<string, CatalogAnswer>;
  reading: ReadonlySet<string>;
};

const BLANK: CatalogAnswer = { rows: null, failure: null };

export class CatalogSearchStore extends SnapshotStore<CatalogSearchSnapshot> {
  private answers = new Map<string, CatalogAnswer>();
  private running = new Set<string>();

  constructor(private readonly ask: Ask) {
    super({ answers: new Map(), reading: new Set() });
  }

  /** What a query answered, or a shared blank before it was asked. */
  answer = (query: string): CatalogAnswer => this.answers.get(query) ?? BLANK;

  /**
   * Ask a query, once for the Session. A return after a Title or a grid joins
   * the answer already held; a failure is retried through `retry`, which is the
   * screen's own Try again.
   */
  search(query: string): void {
    if (this.answers.has(query) || this.running.has(query)) {
      return;
    }
    this.send(query);
  }

  /** Ask a failed query again, the one Action the person pressed for. */
  retry(query: string): void {
    if (this.running.has(query)) {
      return;
    }
    this.answers.delete(query);
    this.send(query);
  }

  private send(query: string): void {
    this.running.add(query);
    this.publish();
    void this.resolve(query);
  }

  private async resolve(query: string): Promise<void> {
    let outcome: ActionOutcome;
    try {
      outcome = await this.ask({ type: "search_catalogs", query });
    } catch (caught) {
      outcome = { response: null, error: asActionError(caught) };
    }
    this.running.delete(query);
    this.answers.set(
      query,
      outcome.error
        ? { rows: null, failure: outcome.error }
        : { rows: answeredCatalogs(outcome.response), failure: null },
    );
    this.publish();
  }

  private publish(): void {
    const reading = new Set(this.running);
    this.publishSnapshot({ answers: new Map(this.answers), reading }, (previous) =>
      previous.answers.size === this.answers.size &&
      [...this.answers].every(([query, answer]) => previous.answers.get(query) === answer) &&
      sameSet(previous.reading, reading));
  }
}
