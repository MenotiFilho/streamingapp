import { Button } from "./kit";
import { useShell } from "./context";
import type { Title } from "../host-client";
import { backdropOf, nameOf } from "../title";
import type { HomeCard } from "./home";

/**
 * The Title a person opened from Home, drawn over Home.
 *
 * The full Title screen — facts, season chips, episode stills and the pushed
 * Streams level — is #81's screen; this arrival keeps the press honest until
 * that level replaces it: the Host's answer with the card's own words and art
 * standing in where the answer is sparse (ADR-0011), and one way back.
 */
export function TitleArrival({
  title,
  preview,
}: {
  title: Title;
  preview?: HomeCard | null;
}) {
  const { pop } = useShell();
  const name = nameOf(title, preview);
  const art = backdropOf(title, preview);

  return (
    <section className="home-title" data-testid="title-level" aria-label={name}>
      {art ? <img className="home-title-art" src={art} alt="" /> : null}
      <span className="home-title-scrim" aria-hidden="true" />
      <div className="home-title-copy">
        <Button variant="ghost" onClick={pop}>
          Back
        </Button>
        {title.logo ? (
          <img className="home-title-logo" src={title.logo} alt={name} />
        ) : (
          <h2 className="home-title-name">{name}</h2>
        )}
        {title.description ? <p className="home-title-body">{title.description}</p> : null}
      </div>
    </section>
  );
}
