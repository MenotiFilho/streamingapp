/**
 * One run per key at a time.
 *
 * A control that waits on the Host must not send the same Action twice: the
 * second arrival queues behind the first in the Host's change lock, and a "next
 * episode" pressed twice would step two episodes. The guard is keyed by the
 * Action's own shape, so two different controls that ask for the same thing
 * share one dispatch, and the key is freed when the run settles — a refusal is
 * something a person can try again (#137, ADR-0022).
 */
export class InFlight<T> {
  private readonly held = new Map<string, Promise<T>>();

  /**
   * Run `work` under `key`, or join the run already under way.
   *
   * The promise a joiner gets is the first run's own, so both callers see the
   * same answer or the same refusal.
   */
  run(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.held.get(key);
    if (running) {
      return running;
    }

    const started = (async () => work())();
    this.held.set(key, started);
    const release = () => {
      // Only the run that owns the key may clear it: a later run for the same
      // key is started after this one has settled.
      if (this.held.get(key) === started) {
        this.held.delete(key);
      }
    };
    void started.then(release, release);
    return started;
  }
}
