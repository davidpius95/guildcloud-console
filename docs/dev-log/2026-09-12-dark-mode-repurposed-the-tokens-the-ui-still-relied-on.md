# Dark mode repurposed the tokens the UI still relied on

**Date:** 2026-09-12

Reported as "the UI glitches" on the provisioning, connect-command and
reveal-password screens — overlapping panels, wrong colours, things that
looked broken at random. It was not random. Four distinct defects, three of
them the same root cause.

## Root cause: an inverted token, still used as a colour

`globals.css` implements the console dark theme by **remapping the ink scale
inside `.console-root`** rather than by adding `dark:` variants. That is a good
decision and it is documented in the file. But the remap inverts the ends of
the scale:

```css
.dark .console-root {
  --color-ink-900: #ffffff;
  --color-ink-950: #ffffff;
}
```

The block's own comment anticipates the hazard — anything that must *stay*
dark has to be pinned to a literal hex. Three places had not been:

| Surface | Class | Result in dark |
|---|---|---|
| Modal backdrop | `bg-ink-950/50` | **White wash** over the whole page instead of a dim scrim |
| How-it-works panels (×4) | `bg-ink-950` + `text-white` | **White on white** — the panels rendered blank |
| How-it-works step badge | `bg-ink-900` + `text-white` | Invisible step number |

Verified in the browser, not inferred: `getComputedStyle` returned
`rgb(255, 255, 255)` for `bg-ink-950` inside `.console-root.dark`, and the
backdrop measured `oklab(0.999994 …/0.5)` — white at 50%.

`Sidebar` uses `bg-ink-950/96` and is **correct**, because it is mounted
outside `.console-root` in `app/console/layout.tsx`. That is worth knowing
before "fixing" it.

## The modal could not be finished on a phone

Independent of colour. The overlay was `fixed inset-0 flex items-center`, the
dialog `overflow-hidden` with no height bound. A flex item taller than a fixed
parent overflows in *both* directions and nothing can scroll to either end.

Measured at 375×812 with the reveal-password dialog open:

- dialog height **980px** in an **812px** viewport
- `dialogTop: -84` — the title clipped off the top
- footer bottom at **896px** — "Yes, reveal it now" **84px below the fold**

So on a phone the one-time password could be neither confirmed nor cancelled.
Now: `overflow-y-auto` on the overlay, `max-h-[calc(100dvh-2rem)]` on the
dialog, and the body as the only scrolling region so the header and footer
stay pinned and reachable. Re-measured at 375×812: dialog 780px, top 16,
bottom 796, both footer buttons reachable.

Also added, because a dialog has to do these: page scroll lock while open
(the wheel used to scroll the page underneath), focus moved into the dialog
and restored on close, a Tab trap (the page behind was keyboard-reachable
through the backdrop), and `useId` instead of a hardcoded `id="modal-title"`
that duplicated whenever two modals were mounted.

## The auth pages were never themed at all

`.dark body` darkens the background globally, but the ink remap was scoped to
`.console-root` — which the `(auth)` layout never mounts. So on `/sign-in`,
`/sign-up`, `/connect/<token>` and `/accept-invite/<token>`, dark mode gave a
near-black background with `text-ink-900` (#171d36) headings still at their
light values. Near-black on near-black.

This is reachable in normal use: the theme bootstrap in `app/layout.tsx` sets
`.dark` on `<html>` from `localStorage` on *every* page, so anyone who chose
dark in the console and then signed out, or opened an enrollment link, landed
on an unreadable page.

Fixed by adding `.auth-root` to the same remap and mounting it in the `(auth)`
layout. While there: the override list only named `bg-white` and
`bg-white/90`, so `bg-white/80` (auth feature cards) and `bg-white/70`
(**operation-progress**, the provisioning panel) stayed literal white patches
on a dark console. All three translucent variants now have rules.

## Smaller correctness fixes in the same surfaces

- **`ConnectInstructions`** claimed `role="tab"` with no `aria-controls`, no
  `tabpanel`, and no arrow-key handling — a keyboard user could not reach the
  command for their own machine. Now a real tablist: roving tabindex,
  Arrow/Home/End, and a labelled panel.
- **`CopyField`** ignored the promise from `navigator.clipboard.writeText`,
  which rejects on an insecure origin or denied permission. The button said
  "Copied" for a one-time password that had never reached the clipboard. Now
  it awaits, and on failure selects the text and says "Select + copy", with an
  `aria-live` announcement. Its `setTimeout` is also cleared on unmount —
  closing the reveal modal inside the 1.6s window wrote state into an
  unmounted component.
- Copy/typography in the connect flow normalised to typographic apostrophes
  and em dashes, and the Windows step now says *choose "Run as administrator"*
  rather than quoting it with straight marks mid-sentence.

## Verification

`typecheck`, `lint`, `test:ui` (21) and `build` all clean. The project's own
axe gate (`tests/e2e/public-accessibility.spec.ts`) passes 6/6 across desktop
and mobile Chromium — that suite covers `/sign-in` and `/sign-up`, which this
change touches.

Checked in a real browser in both themes: backdrop
`rgba(14, 18, 38, 0.55)`, `bg-white/70|80|90` all resolving to translucent
surface, and the pinned `#0e1226` panels keeping white text legible.

## Not changed, deliberately

`StatePill` and `Note` keep literal Tailwind palette colours
(`bg-sky-50`, `bg-amber-50`, …), so they read as light chips on a dark
surface. They stay legible — dark text on a light chip — and restyling the
whole status vocabulary is a bigger, separate decision than this fix.
