import { MarqueeEntry } from "./marquee/MarqueeEntry";
import { mountWindow } from "./mount";

/** The window the Host's WebView loads (`index.html`): the ten-foot shell. */
mountWindow(<MarqueeEntry />);
