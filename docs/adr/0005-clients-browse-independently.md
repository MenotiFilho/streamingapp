# Clients browse independently; navigation is not shared state

Each client — the Host's own UI, the rebuilt companion, a browser — keeps its own
browse and navigation state, and sends the Host intent ("play this Video",
"switch source"), never screen-steering commands. Consequence: the API must
expose enough for a client to browse alone (catalogs, library, search, metadata),
and playback is the only state that is truly shared, so two clients can look at
different screens while one of them plays. We rejected the alternative — one UI
state that a remote steers — which needs a smaller read surface but stops two
people from using the TV and the phone at the same time.
