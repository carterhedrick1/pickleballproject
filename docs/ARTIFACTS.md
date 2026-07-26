# The published artifact pages

The three regenerable views in this folder are also published as Claude artifact pages, so they
can be opened in a browser and shared without running anything. They are **not** live — they are
a snapshot of whatever `npm run docs` last produced, so they only stay honest if they are
republished after a change ships.

| Artifact | Source file | URL |
| --- | --- | --- |
| IN or OUT — Actual Screens | `docs/screens.html` | https://claude.ai/code/artifact/ade73f9e-a5cd-49dd-b08e-4474834b2e81 |
| IN or OUT — Page Containers | `docs/containers.html` | https://claude.ai/code/artifact/f92d850e-0ee8-40d2-bc71-bc4dbf613761 |
| IN or OUT — Numbered Copy Deck | `docs/copy-deck.html` | https://claude.ai/code/artifact/f56569ae-2839-4ec4-bcbd-a57fcf699b51 |

There is a fourth, older page — *IN or OUT — Screen Map*
(`a9a93896-9f2c-490d-a405-25b885289b84`) — with no source file in this repo. Nothing regenerates
it, so treat it as retired rather than trying to keep it current.

## Refreshing them

```
npm run docs
```

Then republish each of the three files to **its existing URL from the table above**. Passing the
URL is what keeps the link stable; publishing the same file without it mints a brand new page and
the link Scott already has goes stale. Because the published copy is always older generated
output rather than someone's hand edits, overwriting it is the intended outcome — the update is
safe to force if the tool reports a conflict.

The titles inside the HTML (`<title>IN or OUT — …`) match the artifact names exactly, which is
how a file gets matched back to its page if this table is ever lost.

## When to bother

After any change that alters what a user sees: page copy, layout, a new screen, a changed flow.
Server-only changes with no visible surface do not move these pages.
