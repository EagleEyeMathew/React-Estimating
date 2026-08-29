# Ceiling setout

A setout and documentation tool for suspended ceilings. It takes a ceiling boundary of
any shape, applies a manufacturer's spacing and span rules, and generates the whole
suspension setout in 3D — hangers, top cross rails, furring channels, grid members,
brackets, edge trims and penetration trimming — with shop drawings, setout dimensions
and a bill of materials.

It is not a structural certifier. It applies the values entered in a rule pack and
reports anything outside them. **Structural verification remains with the engineer**,
and every drawing it produces says so.

## What it will not do

- **It will not invent a figure.** Every spacing, span and load value lives in a
  versioned JSON rule pack. A value that has not been entered is `null`, and null is
  not a default: the engine reports the gap by name and refuses to generate that layer.
  Baking in a half-remembered span figure is the worst thing this app could do, so it
  cannot.
- **It will not assume a rectangle.** Every algorithm is written against an arbitrary
  simple polygon with holes. A concave room, a wall at 7 degrees and a round column are
  the normal case, not the exception.
- **It will not claim compliance.** The output says "within the rule pack values
  entered", names the pack version, and states where each figure was said to come from.

## Layout

```
packages/geometry   polygon booleans, offsetting, line-array clipping, arcs, planes
packages/rules      rule pack schema, loader, value resolution, packs
packages/engine     the twelve-step generation pipeline
packages/drawing    dimensioning, DXF, PDF, SVG, schedules, bill of materials
apps/web            React + react-three-fiber viewer, editors, exports
```

`geometry`, `rules`, `engine` and `drawing` are pure and headless — JSON in, JSON out,
no React and no Three.js — and are tested on their own. The app is a client of them.

## Running it

```sh
pnpm install
pnpm test          # 176 tests across the four packages
pnpm typecheck
pnpm dev           # the app on http://localhost:5173
```

The app opens on a demo project: a concave office with a skew wall and a round column,
a raked meeting room over purlins, and a reception on an exposed grid. It generates
against **example packs whose numbers are invented**, so the demo has something to draw.
Every output from them is watermarked accordingly.

## How generation works

A rule pack declares *layers* and what each bears on. The engine reads that; it knows
nothing about any particular ceiling system, which is why adding one is a data task.

1. **Resolve the zone** — boundary less holes, ceiling plane, structure above.
2. **Setout direction** — the user's, else the longest wall, else the principal axis.
   Nothing snaps to the world axes.
3. **Setout origin** — balanced so opposite edge cuts match, or a nominated datum.
4. **Primary members** — for a free spacing, the first and last go at the setback off
   each wall and what is between is divided into equal bays no wider than the maximum.
   That is what a setter-out does, and it beats running at the maximum and infilling.
   A fixed module (a tile grid) is centred on its module instead and never adjusted.
5. **Secondary members** — spacing capped by the allowable span of what they carry, so
   asking for a heavier lining pulls the rails in.
6. **Hangers** — distributed along their host with both free ends covered, then snapped
   onto structure. Over purlins the crossings are the only usable positions; where none
   is reachable a bridging member is emitted, reported, and marked for the engineer.
7. **Drops** — structure level less ceiling level less build-up, per point. Rakes and
   stepped soffits fall out of this.
8. **Penetrations** — openings over the pack's threshold are cut out and trimmed both
   sides. Smaller ones move the setout instead: the search varies how far off the wall
   the first member sits, and only adds a bay when nothing else keeps the lights clear.
9. **Perimeter** — trim round the walls and structural voids, as one run per wall, with
   a round column scheduled as one curved run rather than thirty-two offcuts.
10. **Bracing** — off by default in every pack, because whether a ceiling needs restraint
    is a question for the engineer.
11. **Validate** — spans, end overhangs, unsupported areas, drops, containment and module
    breaches, all re-checked on the finished members rather than trusted from generation.
12. **Optimise** — cut lengths nested into stock lengths, with waste and pack quantities.

Everything is generated in plan and projected onto the ceiling plane at the end, which is
why a rake needs no special case anywhere upstream.

## Hardware

Members are drawn as the sections they are, not as bars. A furring channel is a top
hat, a top cross rail is a C-channel, wall angle is an L, a hanger is a rod — and a
KEY-LOCK clip is a folded plate straddling the rail with its feet under the channel
flanges.

The sections live in the rule pack, because a section is a manufacturer figure like a
spacing and the same rule applies: none of it is in code. A section is either the line
the metal follows plus its gauge (channels, angles, tees — how they are drawn and how
they are rolled), an outline for a solid, or a diameter for a rod. Point hardware that
has no section to extrude — clips, brackets — is a handful of primitives instead.

Everything falls back honestly. A product with no section drawn but an overall size
entered is shown as a plain rectangle of that size; one with neither is shown at a
nominal size. The member inspector says which of the three you are looking at, because
a bar that is the right size and the wrong shape must not read as the product.

The loader cross-checks the drawn section against the size catalogued beside it, which
is how a crown width typed into the overall-width field gets caught rather than
silently producing a section half the width of the member it represents.

## Determinism

Same project and same pack versions produce byte-identical output. Boolean operations run
on a one-micron integer lattice, there are no timestamps in the result, and ordering is
canonical rather than incidental. Regenerating after changing one figure shows a real diff
rather than noise.

## Provenance

Every member records the value path that decided its position, everything else that was
weighed, the pack version, and the citation recorded against that figure. The member
inspector, the DXF, the PDF and the provenance schedule all show it. A figure entered
without a source is flagged as uncited rather than quietly accepted.

## Overrides

Manual edits live as a diff keyed on member identity, which comes from the setout lattice
rather than generation order — so editing one end of a room survives a change at the other
end. An override whose member no longer exists is reported, never dropped in silence.

## Rule packs

Five skeletons ship with every figure blank:

| Pack | System |
| --- | --- |
| `rondo_keylock` | Rondo KEY-LOCK concealed suspended ceiling |
| `tbar_grid` | Exposed T-bar suspended grid |
| `rondo_furring_directfix` | Rondo furring channel direct fix |
| `nvelope_rail` | Nvelope bracket and rail subframe |
| `sculptform_batten` | Sculptform click-on batten over a subframe |

One further pack, `rondo_flexistrut`, was read from a real detail rather than shipped
blank: a Rondo furring ceiling on a Flexistrut subframe under existing joists. It
carries the product codes and section sizes that detail calls up, and the spacings that
detail was set out at — cited to the detail, and marked as the spacing *used on that
job*, not as a manufacturer maximum. Seventeen figures it does not carry are still
blank, so it does not generate until they are entered. That is the point.

A suspension can be more than one stage. That pack is four tiers: a slotted angle fixed
across the joists, an M10 rod down to a strut, an M6 rod down to the top cross rails,
and the furring clipped up under them. A hanger names what it hangs from, so each rod
spans between the two layers it actually joins rather than every hanger being assumed
to reach the slab. Both ends come from the layers themselves, which is what stops a rod
stopping short of the rail it holds.

Fill them in from the current manufacturer literature using the rule pack editor, which
records the document and revision against each value. Publishing forks to a new version,
so a project saved against `2026.1` keeps regenerating against `2026.1`.
