# GPL-3.0, linking a stock GPL mpv

The app is GPL-3.0-or-later. mpv's default build is GPLv2+, so a GPL app may link
and bundle it without further obligation, whereas a permissive app would need an
LGPL-mode mpv build (`-Dgpl=false`) that disables parts of mpv. We also never
bundle or host AGPL addons such as AIOStreams: those stay services the user
configures. Consequence: contributions arrive under GPL-3.0, and relicensing
later would mean rebuilding mpv in LGPL mode. Harbor ships MIT while linking GPL
mpv; we deliberately do not copy that.
