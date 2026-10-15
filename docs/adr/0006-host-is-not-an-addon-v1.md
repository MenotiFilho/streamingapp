# The Host is a client of the addon protocol, not a server of it (v1)

The Host consumes Stremio addons but does not publish a manifest, so other
Stremio clients cannot install it as a source. The protocol layer is written so
that serving one later is an added surface rather than a rewrite. Reason: being
an addon means being a network service other applications depend on, with its own
reachability, availability and authorization story, and the remote API is already
the whole surface we want to maintain. Consequence: debrid keys and provider
configuration stay usable only by this Host's own clients.
