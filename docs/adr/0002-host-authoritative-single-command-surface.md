# The Host is authoritative, and every client is an adapter over one command surface

All state — configured addons, catalogs, watch progress, playback — lives in the
Host, and both the local UI and every remote client mutate it through the same
internal command surface; pushed snapshots are the only way state travels
outward. We rejected the alternative (a privileged in-process desktop UI plus a
curated API subset) because a remote that can do 80% of what the local UI can do
is the exact failure this project exists to avoid. Consequence: a capability is
added to that one surface, never to a single client, and the local UI gains no
private mutation path.
