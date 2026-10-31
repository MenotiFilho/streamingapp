# The phone's Back unwinds the Remote, and the browser's history is a trap of one entry

The served Remote keeps all of its navigation in the page: a destination, a
stack of Levels, the shared sheet and the Cast Remote, unwound by one `goBack()`
that `Escape` and `Backspace` already reach — a Level's own `‹ Back` pops that
Level directly, and the gesture should land in the same place (ADR-0005,
ADR-0018). The phone's system Back reached none of it. The page had no history
entries, so Android handed the gesture to the browser, which left the page and
went on to whatever had been open before — mid-film, with the remote in hand.
This records how the system Back was brought into the one path.

**One opaque sentinel entry, not one per Level.** While the page is paired it
stands on a single `history.pushState({ remote: "sentinel" }, "")` entry, with
the page's own entry below it. A Back pops the sentinel, a `popstate` handler
runs `goBack()`, and a fresh entry is pushed if the page still had something to
unwind. The internal stack stays the only truth. Mirroring it into history would
have to model the sheet and the Cast Remote, which are not Levels, and the two
stacks would drift: a sheet opened from a Level would leave a history entry that
no Level matches. Nothing of the position reaches the URL, so the page is still
not addressable and a reload still starts at Home; entries are deliberately
opaque.

**Two presses leave, and the first one says so.** At the foot of the page
`goBack()` answers `false`, the press is absorbed, and a short `Press back again
to leave` notice appears for two seconds. The page does not push another entry
then, so the next Back is the browser's: leaving is deliberate, not accidental,
and still possible. Any navigation re-arms the sentinel — a Destination, a Level,
the sheet, the Cast Remote — so arriving back at the foot always costs two
presses, wherever you came from. A reconnect's Welcome is not a navigation and
must not re-arm, or the trap the warning had opened would close itself on the
next probe. Before a Device is adopted the page keeps no entry at all — a pairing
form is not somewhere to go back into — and a revoked Device falls back to it.

**Rejected, with reasons:** *one history entry per Level* (the sheet and the Cast
Remote are not Levels, so the two stacks disagree on the second press); *never
re-arming* (the page becomes a trap that can only be left with the tab's own
controls); *`beforeunload`* (a browser will not honour it for a Back gesture
without a prior interaction, and it asks a question instead of answering one);
*the position in the URL* (a second source of truth for navigation that ADR-0005
says belongs to the device, and a format to maintain for a page served at `/`).

**Consequences.** A page that leaves keeps one phantom entry in the tab's
history, and a reload lands on a sentinel rather than stacking another. With the
on-screen keyboard up the first Back belongs to Android and closes the keyboard;
the page receives nothing, which is the behaviour a person typing already
expects. A forward traversal lands on the sentinel itself and does nothing, so
the browser's forward button cannot be mistaken for a Back. The jsdom page smoke
asserts the decisions: armed after the Welcome, the URL unchanged, a Back unwinds
a Level and the Cast Remote, the Back at the foot warns and leaves the next one
to the browser, and neither a Snapshot nor a reconnect's Welcome re-arms.
