# Cozy Village — 3D Asset Design Brief

This document specs every building and prop that needs a real 3D model, with enough
detail that a designer working from this brief alone (no access to the game) should
land within one revision. Read the **Style Guide** first — it applies to every asset
below and is the part most likely to cause mismatches if skipped.

---

## 1. Style Guide (applies to everything)

**Overall direction:** cozy stylized low-poly, closer to *Manor Lords* / *Townscaper*
than photoreal. Warm, hand-built, slightly whimsical — not gritty, not cartoonish.
Buildings should look like a real medieval-ish farming valley, but simplified into
clean geometric shapes with flat or softly-shaded surfaces.

**Camera & scale**
- Viewed from a fixed 3/4 isometric-ish angle, camera pitched ~35–55° above horizon,
  typical viewing distance shows a building at roughly 80–200px tall on screen.
- **1 world unit = 1 tile ≈ 1 meter.** A 3×2 building footprint = 3m × 2m at the base.
- Reference heights: a cottage eave sits ~2m, a windmill/church tops out ~7–9m tall.
- Because the camera never gets close or low, **silhouette and roofline read more
  than surface detail.** Prioritize a distinctive shape over fine texture.

**Materials & rendering**
- Flat-shaded or lightly-faceted low-poly look — visible flat facets are *desired*,
  not a flaw. Avoid smooth photoreal shading, avoid PBR metal/glass shine.
- No baked-in shadows or ambient occlusion in textures — lighting is dynamic
  (day/night cycle, seasonal color shift) and baked shading will look wrong at
  other times of day.
- Prefer flat vertex/material colors over detailed textures. If textures are used,
  keep them simple, painterly, low-frequency (no fine noise, no photo-sourced
  materials, no visible brick/plank photo textures — stylized flat color blocks
  with maybe one tone of shading variation per surface).
- Poly budget: keep each building under ~2,000 triangles. Small props/decor under
  ~300 triangles. This is a village of 40+ simultaneous buildings plus villagers —
  it needs to run smoothly, not look like a hero asset.

**Palette — use these hex values as the anchor, do not introduce new hues**
| Role | Color | Hex |
|---|---|---|
| Wall (light plaster/linen) | Cream/linen | `#EFE3CF` |
| Wall (sand) | Warm sand | `#E3CBA6` |
| Timber trim/frame | Warm brown | `#8A6244` |
| Timber trim (dark) | Dark brown | `#6B4A33` |
| Thatch roof | Straw gold | `#C9A45F` |
| Terracotta roof (tile) | Burnt orange | `#C06B41` |
| Clay/brick wall | Clay red | `#A8563A` |
| Stone wall | Warm grey stone | `#B5AA98` |
| Stone (dark/shadow side) | `#8D8375` |
| Slate roof | Cool grey | `#76706A` |
| Accent gold | Honey | `#E0A756` |
| Accent green | Moss | `#7F9159` |
| Soil / dirt path | `#8A6C4C` |
| Water | Teal | `#6EA3AE` |

- **No pure black, no pure white, no saturated primary colors** (no bright red,
  bright blue, neon anything). Everything sits in this warm, slightly desaturated
  earth-tone family.
- Windows: warm amber glow color `#FFD9A0` when "lit" is a separate in-engine
  material swap — model windows as simple flat dark recessed panes (`#4A3A2C`),
  do not bake in glow.

**Construction-site variant**
- Every building needs to visually read at 0% (bare frame/scaffold), ~50%
  (partial walls, materials stacked), and 100% (finished) if the designer is able
  to provide a simple frame/scaffold version. If only one state is feasible,
  prioritize the **100% finished** version — the game can scaffold-fade it
  procedurally.

**What to avoid across all assets**
- Photorealism, painterly realism, or "asset flip" generic fantasy village style.
- Modern materials: glass panes, corrugated metal, plastic, glossy paint.
- Overly ornate gothic/fantasy detailing (gargoyles, spires with filigree) — keep
  it humble and rural even for the "grand" civic buildings.
- Dense small-scale texture noise (individual roof shingles, individual bricks,
  wood grain) — suggest these with 2–4 large shape divisions, not hundreds.
- Asymmetric "busy" silhouettes that don't read as their building type from 100m
  isometric distance.

**Delivery format**
- glTF/GLB preferred (or FBX with baked transforms), Y-up, origin at the center
  of the footprint base (ground level, not bounding-box center).
- Grouped/named submeshes if the building has moving parts (windmill sails,
  waterwheel, market awnings flapping) so they can be animated independently.
- Provide a turntable render or 4-angle orthographic reference alongside the file.

---

## 2. Housing

### Cottage
- **Footprint:** 2×2 tiles. **Eave height:** ~2.1m.
- **Silhouette:** small single-story rectangular home, steep pitched gable roof
  (roof pitch reads as ~45°), one off-center door, 2 small windows.
- **Materials:** cream/linen plaster walls (`#EFE3CF`), thatch roof (`#C9A45F`),
  exposed dark timber corner posts and one horizontal timber brace (half-timber
  framing look, but sparse — 2 posts + 1 beam, not a full Tudor grid).
- **Must have:** visible door (`#6B4A33` flat panel), 2 windows, a single small
  brick chimney on one gable end.
- **Must not have:** dormer windows, second story, stone foundation courses,
  decorative shutters — keep it plain and humble, this is the starter home.
- **Reference feel:** a single peasant farmhouse, not a cottagecore fantasy cottage.

### Longhouse
- **Footprint:** 3×2 tiles. **Eave height:** ~2.4m.
- **Silhouette:** elongated version of the cottage — same construction language,
  wider, reads as "three homes joined." Consider 2–3 shallow roof ridge breaks or
  3 evenly-spaced doors along the long face to communicate multiple households
  without adding real geometric complexity.
- **Materials:** identical palette to Cottage (they should look like siblings).
- **Must have:** 3 doors OR 3 chimneys along the roofline (pick one, be consistent)
  to signal multi-family occupancy at a glance.
- **Must not have:** anything that makes it look like a barn or civic building —
  it must still read as "home," just bigger.

---

## 3. Gathering

### Woodcutter's Camp
- **Footprint:** 2×2. **Height:** ~1.8m.
- **Silhouette:** NOT a fully enclosed building — an open-sided lean-to/shelter
  with a single-pitch roof over a work area. No walls, or at most one back wall.
- **Materials:** rough dark timber posts (`#6B4A33`), thatch or timber-shingle
  roof, unfinished/rustic look (rougher than the cottage's timber).
- **Must have:** a stack of round logs (3–5 cylinders, varying length) near the
  shelter, an axe or two visibly leaning against a post.
- **Must not have:** walls, windows, a proper door — this is a work camp, not a
  house.

### Forester's Hut
- **Footprint:** 2×2. **Height:** ~1.9m.
- **Silhouette:** small enclosed timber hut, smaller/humbler than a cottage.
- **Materials:** same timber-and-thatch language as Woodcutter's Camp but fully
  walled with a door.
- **Must have:** 2–3 small sapling bundles or a basket of seedlings resting
  outside the door (this is the visual cue that it plants trees, not fells them).
- **Must not have:** log piles (that's the Woodcutter's signature, don't overlap).

### Forager Hut
- **Footprint:** 2×2. **Height:** ~1.7m.
- **Silhouette:** small rustic hut, slightly smaller/lower than Cottage.
- **Materials:** sand-colored walls, thatch roof.
- **Must have:** hanging bundles of herbs/berries drying under the eave (2–3 small
  bundle props), a woven basket by the door.
- **Must not have:** a chimney (no cooking implied here).

### Hunter's Lodge
- **Footprint:** 2×2. **Height:** ~2.0m.
- **Silhouette:** sturdier timber lodge, slightly more rugged than the cottage.
- **Materials:** dark timber walls (not plaster — this one is log-cabin style,
  horizontal log courses), thatch or timber-shingle roof.
- **Must have:** a hide-stretching frame (a simple rectangular frame with a
  stretched pelt shape) leaning against an outer wall, small antler/rack mounted
  above the door.
- **Must not have:** anything cute — this building should feel slightly more
  weathered/rugged than the farming buildings.

### Fishing Hut
- **Footprint:** 2×2, **must sit at the shoreline**. **Height:** ~1.8m.
- **Silhouette:** small hut on/near the water with a short wooden dock/pier
  extending toward the water on one side.
- **Materials:** timber, weathered grey-brown planks rather than clean cream walls
  (this one should look slightly damp/weathered).
- **Must have:** the dock (3–4 plank segments on posts extending over the water
  edge), a net or two hanging to dry, a small rowboat or canoe shape optional but
  welcome if budget allows.
- **Must not have:** a chimney; keep the roof low and simple.

### Herbalist's Hut
- **Footprint:** 2×2. **Height:** ~1.7m.
- **Silhouette:** near-identical base to Forager Hut but distinguish clearly — this
  one should read as more "workshop," the Forager Hut more "storage."
- **Materials:** same rustic timber/thatch family.
- **Must have:** a small drying rack (horizontal pole with 4–5 hanging herb
  bundles) as the primary silhouette feature, distinct from Forager's basket.
- **Must not have:** duplicate the basket-by-door detail from Forager Hut — give
  it a different signature prop so the two are distinguishable from above.

### Quarry
- **Footprint:** 3×3. **Height:** low, ~1.4m at the tallest point (mostly a pit,
  not a structure).
- **Silhouette:** an open excavated stone pit with terraced/stepped edges, NOT a
  building. Rough-cut stone blocks scattered near the rim.
- **Materials:** exposed grey stone (`#B5AA98` lit face, `#8D8375` shadowed face),
  bare dirt rim (`#8A6C4C`).
- **Must have:** 2–3 roughly-cut rectangular stone blocks sitting near the pit
  edge (implies extraction), a simple wooden hoist/winch arm is a nice-to-have.
- **Must not have:** any roofed structure — this is purely a landscape excavation.

### Clay Pit
- **Footprint:** 3×3. **Height:** low, ~1.2m.
- **Silhouette:** similar language to Quarry but wetter/muddier — a shallow open
  pit with visible wet clay color, simple timber retaining boards along one or
  two edges (not a full frame).
- **Materials:** warm reddish-brown clay (`#9C7350`), damp-looking (slightly
  darker/desaturated than dry soil), grey-brown timber retaining boards.
- **Must have:** a small stack of cut clay blocks/bricks-in-progress near the rim.
- **Must not have:** stone — keep it visually distinct from Quarry (clay = warm
  brown/red, stone = cool grey).

### Iron Mine
- **Footprint:** 3×3. **Height:** ~2.6m (the entrance structure is the tallest
  part).
- **Silhouette:** a timber mine entrance/headframe built into a low rock outcrop —
  think a simple A-frame or box frame around a dark doorway cut into stone,
  with a small ore cart on rails in front.
- **Materials:** dark timber frame, grey stone outcrop backdrop, dark opening
  (`#2A241F`) for the mine mouth, small rust/ore-colored (`#7C6F63`) cart.
- **Must have:** the dark mine-mouth opening as the clear focal point, a small
  ore cart, timber support frame around the entrance.
- **Must not have:** an enclosed roofed building — this should read as "entrance
  built into the hillside," not a house.

---

## 4. Farming

*Fields, pastures and orchards are drag-to-size in-game (player draws the plot,
from roughly 3×3 up to 9×9 tiles), so these need to be built as tileable/modular
elements or as a system that scales, not a single fixed-size model. Coordinate
with engineering on delivery format (e.g. a repeatable "furrow row" module vs. a
full custom mesh) before finalizing geometry.*

### Wheat Field
- **Silhouette:** furrowed soil in parallel rows running the depth of the plot,
  crop planted in each furrow. Needs **3 growth-stage variants** sharing the same
  furrow base: (1) bare tilled soil, no crop, (2) young green shoots ~30% height,
  (3) full-height golden ripe wheat.
- **Materials:** soil `#8A6C4C`, young shoots moss green `#7F9159`, ripe wheat
  golden `#D9BB84`.
- **Must have:** visible furrow/row structure (not a flat painted plane — actual
  raised row geometry catches light and sells the "farmed ground" look).
- **Must not have:** individual wheat stalk detail at the geometry level — suggest
  texture/shape at the row level, not per-stalk.

### Orchard
- **Silhouette:** a grid of small fruit trees planted in rows across the plot.
  Needs one tree module (trunk + rounded canopy) repeated in a grid pattern that
  scales with plot size.
- **Materials:** timber-dark trunk (`#6B4A33`), moss-green canopy (`#6F8F4E`),
  small red/warm fruit accent dots optional in summer/autumn variant.
- **Must have:** a single simple tree module, low-poly rounded/faceted canopy
  (icosahedron-like, not a realistic tree), grass ground plane beneath.
- **Must not have:** varied tree species — every tree in one orchard should be
  the same simple module for visual consistency and performance.

### Sheep Pasture
- **Silhouette:** a fenced paddock — simple post-and-rail fence running the
  perimeter of the plot, open grass interior, a few grazing sheep.
- **Materials:** timber fence posts/rails (`#8A6244`), grass green interior.
- **Must have:** the fence as a modular repeatable segment (post + 2 rails) that
  can tile along any edge length, plus a simple sheep model (rounded white/cream
  body, small dark head/legs, low-poly, no wool texture detail — just a soft
  rounded silhouette).
- **Must not have:** a barn or shelter structure — this is open pasture only.

### Chicken Coop
- **Footprint:** 2×2. **Height:** ~1.2m.
- **Silhouette:** a small low timber coop with an attached open-mesh run/pen.
- **Materials:** timber walls, small ramp/door.
- **Must have:** the small fenced run area adjacent to the coop box, a couple of
  simple low-poly chicken shapes optional.
- **Must not have:** anything taller than knee-height relative to a villager —
  this is the smallest farming structure.

### Apiary
- **Footprint:** 2×2. **Height:** ~1.1m.
- **Silhouette:** 2–3 small stacked hive boxes (simple stepped rectangular
  stacks) in a small wildflower patch.
- **Materials:** pale timber hive boxes (`#EFE3CF`/`#E3CBA6`), small colorful
  wildflower dots in the surrounding grass (moss/honey/warm accent colors only —
  no bright primary flower colors).
- **Must have:** the stepped hive-box silhouette (instantly reads as "beehives").
- **Must not have:** bees as visible geometry (implied, not modeled).

---

## 5. Crafting Workshops

*General workshop language: single-story timber or brick building, one large
work-relevant prop visible either inside (through an open front) or stacked
outside, one chimney if the process involves fire. Keep each one visually
distinct via its outdoor signature prop — that's what players scan for.*

### Sawpit
- **Footprint:** 3×2. **Height:** ~1.9m.
- **Silhouette:** open-sided timber structure (like Woodcutter's Camp but a bit
  larger/more built-up) over a raised sawing platform.
- **Materials:** timber, unfinished/rustic.
- **Must have:** stacked plank piles (flat rectangular stacks, distinct from the
  round-log piles at Woodcutter's Camp) as the signature prop.
- **Must not have:** enclosed walls.

### Woodshed
- **Footprint:** 2×2. **Height:** ~1.7m.
- **Silhouette:** small open-fronted shed, mostly roof over a firewood stack.
- **Materials:** timber.
- **Must have:** neatly split/stacked firewood (short split logs, distinct in
  shape from Sawpit's long planks and Woodcutter's round logs) filling the shed.
- **Must not have:** full enclosure — front should be open to show the woodpile.

### Brick Kiln
- **Footprint:** 3×3. **Height:** ~2.8m.
- **Silhouette:** a squat dome or beehive-shaped kiln structure with a prominent
  chimney, small firing-mouth opening at the base.
- **Materials:** brick/clay red (`#A8563A`), dark opening at the base, chimney
  with a warm glow-ready opening (glow itself handled in-engine).
- **Must have:** the dome/beehive kiln shape as the clear focal silhouette,
  chimney, a small stack of raw clay bricks nearby.
- **Must not have:** confuse with Bakery — Kiln is squat/domed, industrial;
  Bakery (below) is a proper building with a normal roof.

### Pottery
- **Footprint:** 3×2. **Height:** ~2.1m.
- **Silhouette:** a normal small workshop building with a visible potter's wheel
  and shelves of finished pots near the entrance/window.
- **Materials:** clay-red or timber walls, terracotta roof accents welcome
  (thematically appropriate).
- **Must have:** a few simple pot/vase silhouettes (2–3 varying sizes) displayed
  outside or in a window, small wheel prop.
- **Must not have:** a chimney as prominent as the Kiln's — this is the finishing
  shop, not the firing structure.

### Smelter
- **Footprint:** 3×3. **Height:** ~3.0m.
- **Silhouette:** tall stone furnace structure, taller and more vertical than the
  Kiln, single prominent chimney, small ore/charcoal pile at the base.
- **Materials:** stone (`#B5AA98`/`#8D8375`), dark furnace mouth opening, chimney.
- **Must have:** verticality — this should read as the tallest/most industrial of
  the fire buildings, taller than Kiln and Blacksmith.
- **Must not have:** a normal pitched roof — this is a furnace structure, not a
  house shape.

### Blacksmith
- **Footprint:** 3×2. **Height:** ~2.3m.
- **Silhouette:** normal workshop building with a stone/brick forge visible
  through an open front bay, chimney, anvil prop prominent out front.
- **Materials:** stone walls, timber roof.
- **Must have:** an anvil (small distinctive blocky shape) as the clear signature
  prop, chimney, maybe a rack of simple tool silhouettes.
- **Must not have:** confuse silhouette with Smelter — Blacksmith is a normal
  building shape with a workshop bay, Smelter is a standalone furnace tower.

### Windmill
- **Footprint:** 3×3. **Height:** ~4.6m body, sails extend further.
- **Silhouette:** the tallest crafting building — tapered cylindrical or
  hexagonal tower body, conical cap roof, four sails/blades mounted on one face.
- **Materials:** timber body (`#EFE3CF` or `#8A6244`), thatch or timber cap roof,
  pale timber sails (`#EFE3CF`).
- **Must have:** the 4 sails as a **separate animatable submesh/group** rotating
  around a hub — this is a hard technical requirement, not optional. Provide the
  sail assembly as its own named node.
- **Must not have:** windows/doors more than 1–2 — keep the tower silhouette
  clean, the sails are the whole point.

### Bakery
- **Footprint:** 3×2. **Height:** ~2.2m.
- **Silhouette:** cozy small building, brick base, warm chimney, bread visibly
  cooling on a rack near the door/window.
- **Materials:** brick/clay-red lower walls, timber upper, terracotta roof.
- **Must have:** a bread rack/basket with a few loaf shapes near the entrance,
  chimney with warm smoke potential.
- **Must not have:** anything that reads as industrial — this should feel the
  coziest/warmest of the workshop buildings.

### Brewery
- **Footprint:** 3×3. **Height:** ~2.4m.
- **Silhouette:** timber building, several barrels stacked/rolled outside, larger
  footprint than Bakery to fit brewing vats implied inside.
- **Materials:** timber walls and roof.
- **Must have:** 3–4 barrels (simple cylinder shapes) as the clear signature prop
  stacked near the entrance.
- **Must not have:** a chimney as prominent as Bakery/Kiln — brewing implies less
  visible fire than baking.

### Weaver's Shop
- **Footprint:** 3×2. **Height:** ~2.1m.
- **Silhouette:** normal timber workshop, a loom frame visible through a window
  or open bay, wool baskets outside.
- **Materials:** timber, cream/linen walls.
- **Must have:** a simple loom-frame silhouette (rectangular frame with visible
  cross-threads) as signature, a basket with raw wool tufts.
- **Must not have:** confuse with Tailor (below) — Weaver makes cloth from wool
  (raw fiber signature), Tailor makes clothes from cloth (finished garment
  signature).

### Tailor
- **Footprint:** 3×2. **Height:** ~2.2m.
- **Silhouette:** near-twin of Weaver's Shop in construction, but signature prop
  is hanging finished garments (simple flat hanging cloth shapes) rather than a
  loom.
- **Materials:** same timber/linen family as Weaver.
- **Must have:** 2–3 simple hanging cloth/garment silhouettes on a rack outside
  or in a window.
- **Must not have:** the loom — keep these two buildings distinguishable by prop
  only, since the base shape is intentionally similar (both are "cloth
  buildings").

### Tannery
- **Footprint:** 3×2. **Height:** ~2.0m.
- **Silhouette:** timber workshop with large open vats and stretched hides on
  frames outside — this building should look and feel slightly unpleasant
  (nobody wants to live next door, per game lore), so lean into a rougher, more
  utilitarian look than the other workshops.
- **Materials:** darker, more weathered timber than usual, muddy-brown vat
  contents implied.
- **Must have:** stretched hide/pelt frames (flat rectangular frames with a
  hide-shaped fill) as the clear signature, 1–2 open barrel/vat shapes.
- **Must not have:** anything cute or cozy — this is the one workshop allowed to
  look a little grim.

### Cobbler
- **Footprint:** 3×2. **Height:** ~2.1m.
- **Silhouette:** small tidy workshop, shoe/boot shapes displayed on a rack or
  in a window.
- **Materials:** timber, cream walls.
- **Must have:** 2–3 simple shoe/boot silhouettes as the signature prop, rolled
  leather nearby.
- **Must not have:** duplicate Tannery's hide-frame prop — Cobbler works
  finished leather, not raw hides.

### Chandlery
- **Footprint:** 2×2. **Height:** ~1.9m.
- **Silhouette:** small tidy shop, bundles of hanging candles or a candle-dipping
  rack as the signature.
- **Materials:** timber, cream walls.
- **Must have:** hanging candle bundles (thin tapered cylinder shapes, warm honey
  color `#E0A756`) as the clear signature prop.
- **Must not have:** a chimney/fire signature as prominent as Bakery/Kiln — this
  is a small tidy shop, not an industrial building.

### Apothecary
- **Footprint:** 3×2. **Height:** ~2.2m.
- **Silhouette:** small workshop with brick accents, hanging drying herbs and
  jars visible in a window, slightly more "refined" than Forager/Herbalist huts.
- **Materials:** brick-accented timber, cream walls.
- **Must have:** small jar/bottle shapes on a windowsill or shelf, a mortar and
  pestle prop is a nice bonus.
- **Must not have:** duplicate Herbalist Hut's drying-rack signature exactly —
  give the Apothecary jars/bottles as its distinguishing prop instead of loose
  herb bundles.

---

## 6. Civic

### Well
- **Footprint:** 1×1. **Height:** ~1.2m.
- **Silhouette:** small circular stone ring with two posts and a simple peaked
  roof/beam over it, a bucket on a rope optional.
- **Materials:** stone ring (`#B5AA98`), timber posts and roof beam.
- **Must have:** the circular stone ring as the unmistakable base shape.
- **Must not have:** anything oversized — this must stay visually minor, it's a
  1-tile utility prop, not a landmark.

### Market Square
- **Footprint:** 4×4. **Height:** ~1.6m (stalls), open plaza.
- **Silhouette:** an open paved/dirt plaza with 3–4 simple market stalls
  (table + corner posts + angled awning) scattered around the perimeter, not a
  single enclosed building.
- **Materials:** stall frames in timber, awnings in varied warm accent colors
  (terracotta, honey, moss, clay-red — pick from palette, vary per stall for
  visual interest).
- **Must have:** multiple independent stall modules (deliver as 1 reusable stall
  prop the engine can place multiple times) rather than one fixed composition.
- **Must not have:** walls or a roof over the whole plaza — it must stay open
  and airy, the social heart of the village.

### Chapel
- **Footprint:** 3×3. **Height:** ~4.2m.
- **Silhouette:** small humble single-nave timber chapel with a modest bell
  tower/spire on one corner, simple cross accent.
- **Materials:** timber walls, thatch or timber-shingle roof, small honey-colored
  cross accent.
- **Must have:** a modest spire/tower (this is the *humble* version — modest,
  not grand), 2–3 small arched or pointed windows.
- **Must not have:** stone construction (that's reserved for the upgraded Stone
  Church below) — Chapel must read as the humbler, earlier-game timber building.

### Stone Church
- **Footprint:** 4×4. **Height:** ~7.5m.
- **Silhouette:** the grandest building in the village — proper stone nave, a
  taller bell tower with a proper spire, larger arched windows, should visually
  dominate the skyline.
- **Materials:** stone walls (`#B5AA98`), slate roof (`#76706A`), honey-colored
  accent details (cross, trim).
- **Must have:** clear visual escalation from Chapel — taller tower, stone
  instead of timber, larger windows, more presence.
- **Must not have:** gothic excess (flying buttresses, gargoyles, tracery) — keep
  it a humble rural stone church, just the grandest building the village has.

### Tavern
- **Footprint:** 3×3. **Height:** ~3.0m.
- **Silhouette:** warm, welcoming timber inn — hanging sign out front, barrels
  stacked outside, warm and inviting silhouette (slightly wider/lower than a
  workshop, communal feel).
- **Materials:** timber, cream walls, warm terracotta or honey roof accent.
- **Must have:** a hanging sign on a bracket over the door (shape/icon TBD, can
  be a simple mug silhouette), 2–3 barrels outside.
- **Must not have:** a stark/plain look — this should feel like the coziest,
  most inviting building in the whole village.

### Healer's House
- **Footprint:** 3×2. **Height:** ~2.4m.
- **Silhouette:** tidy brick-accented cottage-workshop hybrid, small herb garden
  patch beside it.
- **Materials:** brick accents, cream walls.
- **Must have:** a small garden patch prop (a few low plant/herb shapes) beside
  the building as the signature.
- **Must not have:** anything grim or clinical — keep it warm, this is a
  wellness building not a hospital.

### School
- **Footprint:** 3×3. **Height:** ~3.2m.
- **Silhouette:** brick-and-timber building with a small bell or bell-cupola on
  the roof ridge, slightly more "civic" and orderly than the workshops.
- **Materials:** brick lower walls, timber upper, slate or terracotta roof.
- **Must have:** the small roof bell/cupola as the signature silhouette element.
- **Must not have:** confuse with Chapel — no cross/spire, this is secular.

### Town Hall
- **Footprint:** 4×3. **Height:** ~4.4m.
- **Silhouette:** the largest secular civic building — stone base, prominent
  central gable or small clock/banner feature, should feel authoritative and
  central without being religious in character.
- **Materials:** stone and timber mix, slate roof.
- **Must have:** a clear central-facade focal feature (a clock face, a banner
  pole, or a coat-of-arms panel — pick one), symmetrical facade.
- **Must not have:** a spire or cross (reserve vertical church-like elements for
  Chapel/Church only) — Town Hall should read as civic/secular, wide and
  grounded rather than tall.

---

## 7. Logistics

### Storehouse
- **Footprint:** 3×3. **Height:** ~2.4m.
- **Silhouette:** large plain timber warehouse, wide double doors, minimal
  ornamentation — pure function.
- **Materials:** timber, plain and sturdy.
- **Must have:** large double doors as the focal feature, maybe a loading ramp.
- **Must not have:** decorative elements — this should look the most utilitarian
  building among the logistics group's plain siblings, but slightly larger/plainer
  than Granary.

### Granary
- **Footprint:** 3×3. **Height:** ~2.8m.
- **Silhouette:** raised timber structure on short stilts/posts (traditional
  granary silhouette — raised off the ground to protect grain), small conical
  or pitched roof.
- **Materials:** timber, slightly lighter/tidier than Storehouse.
- **Must have:** the raised-on-stilts base as the clear distinguishing feature
  from Storehouse (Storehouse sits on the ground, Granary is elevated).
- **Must not have:** ground-level doors — access should read as via a ladder or
  raised door, reinforcing the "protected from pests" concept.

### Trading Post
- **Footprint:** 3×3. **Height:** ~2.6m.
- **Silhouette:** part building, part market stall — a small office/booth with
  an attached open awning area, a simple balance-scale prop, maybe a parked cart.
- **Materials:** timber, one canvas awning (terracotta or honey colored).
- **Must have:** a balance/scale prop (two-pan scale silhouette) as the clear
  "trading" signifier.
- **Must not have:** look identical to Market stalls — this is a permanent
  structure, sturdier and more built-up than the open market stalls.

### Road
- **Footprint:** 1×1 tile, tileable. **Height:** flush with ground (~0.05m).
- **Silhouette:** N/A — this is a ground texture/decal, not a volumetric object.
- **Materials:** worn dirt/packed-earth color (`#8A6C4C`), optionally with subtle
  wagon-rut or worn-path variation.
- **Delivery note:** this should be a **flat tileable texture or simple flat
  plane material**, not a modeled asset. Provide as a seamless tileable texture
  (dirt path, ideally with 2–3 subtle variations to avoid obvious repetition)
  rather than geometry.

---

## 8. Decor

### Flower Bed
- **Footprint:** 1×1. **Height:** ~0.3m.
- **Silhouette:** small raised planted bed, a handful of simple flower shapes.
- **Materials:** soil edge, 4–5 small flower blobs in varied warm accent colors.
- **Must have:** stay low and simple — this is a tiny prop, not a garden.

### Street Lantern
- **Footprint:** 1×1. **Height:** ~2.4m.
- **Silhouette:** slim timber or wrought-iron post topped with a small lamp box.
- **Materials:** dark timber or dark iron post, warm glass-substitute lamp panel
  (dark recessed panel like building windows, glows in-engine at night).
- **Must have:** slim, unobtrusive post — should not compete visually with
  buildings.

### Bench
- **Footprint:** 1×1. **Height:** ~0.5m.
- **Silhouette:** simple flat timber bench with a low backrest.
- **Materials:** timber.
- **Must have:** stay simple — 2 legs, seat, backrest, done.

### Fountain
- **Footprint:** 2×2. **Height:** ~1.5m.
- **Silhouette:** small tiered stone fountain — circular basin, central column,
  small top basin/finial.
- **Materials:** stone (`#B5AA98`), water surface color (`#6EA3AE`).
- **Must have:** the tiered/circular silhouette reading clearly as "fountain,"
  should feel like a small centerpiece.

### Village Garden
- **Footprint:** 3×3. **Height:** ~1.4m.
- **Silhouette:** a landscaped green patch — low hedges or planted borders,
  a path through the middle, a couple of larger ornamental bushes/small trees.
- **Materials:** grass, moss-green hedge shapes, soil path.
- **Must have:** a sense of "cultivated open space" distinct from raw wilderness
  or a farm plot — more ornamental, less utilitarian.

### Great Monument
- **Footprint:** 3×3. **Height:** ~9.0m.
- **Silhouette:** the tallest object in the village — a carved stone pillar or
  obelisk on a stepped stone base, simple and dignified rather than ornate.
- **Materials:** stone base (`#B5AA98`), pale stone/linen-colored shaft
  (`#EFE3CF`), honey-colored cap/finial accent.
- **Must have:** a stepped pedestal base, a tall simple shaft, a distinct cap or
  finial shape at the top so the silhouette reads even in fog/distance.
- **Must not have:** figurative sculpture (no statues of people/animals) — keep
  it abstract/architectural, a monument to the village itself.

---

## 9. World dressing & characters (not "buildings" but needed for the same overhaul)

### Villager character
- **Style:** simple articulated low-poly figure — head (sphere), torso, two arms,
  two legs, all simple primitive-derived shapes, NOT anatomically detailed.
- **Proportions:** slightly stylized/chibi-adjacent but not extreme — roughly
  5–5.5 heads tall, readable as an adult at a distance.
- **Variation needed:** skin tone variants (provide as a palette swap, not
  separate meshes), hair color variants, a simple hat (straw/felt, worn by
  adults only), tunic color that swaps by profession (see palette table below).
- **Rig needed:** hip, shoulder (L/R arm), and leg (L/R) pivots at minimum, for
  walk-cycle and simple "chop/harvest" work-motion animation. Provide as a
  rigged skeletal mesh if possible, or clearly separated pivot-ready submeshes
  if not.
- **Profession tunic colors** (flat color swap zones): Gathering `#6B8452`,
  Farming `#B0894F`, Crafting `#8A5A3C`, Civic `#5F7A99`, Logistics `#9D7E4A`,
  general Labourer `#968878`.
- **Must not have:** facial detail beyond the most minimal suggestion of a face,
  detailed clothing folds/wrinkles, individual fingers.

### Sheep (livestock)
- Simple rounded cream/white body, small dark head and legs, no wool texture
  detail — see Sheep Pasture above.

### Trees
- **Pine:** two stacked cones (wide low cone + narrower higher cone) over a
  simple cylindrical trunk. Foliage color shifts seasonally (handled in-engine
  via material swap) — model in a neutral mid-green.
- **Broadleaf:** simple trunk + one or two overlapping rounded/faceted canopy
  blobs (icosahedron-derived). Also needs seasonal color swap support (spring
  green → summer green → autumn gold/orange → bare winter).
- Keep both under ~150 triangles — these are instanced hundreds of times.

### Rocks & ore outcrops
- Simple faceted low-poly boulder shapes, 2–3 size variants. Iron ore variant
  gets a slightly rust-tinted (`#7C6F63`) color variant of the same base shape.

### Carts / wheelbarrow
- Simple wooden two-wheel handcart, used as a hauling prop reference (not
  necessarily a placed object yet, but useful for future logistics flavor).

### Fences
- Modular post-and-rail segment (see Sheep Pasture) — deliver as a single
  tileable segment, not a fixed-length fence.

### Market stall / awning kit
- Modular stall (table + 2 corner posts + angled awning panel) — deliver as one
  reusable prop with 3–4 awning color variants (terracotta, honey, moss, clay-red).

### Boat / dock (Fishing Hut accessory)
- Small simple rowboat/canoe hull shape, optional but welcome; dock as a
  modular plank-on-posts segment.

---

## 10. Quick-reference checklist per asset (send this with every brief)

When reviewing a delivered asset, confirm:
- [ ] Footprint matches the stated tile size at 1 unit = 1m
- [ ] Height matches the stated reference height (±15%)
- [ ] Colors pulled only from the palette table in Section 1
- [ ] Silhouette reads clearly from a 3/4 isometric angle at distance (test by
      shrinking the render to thumbnail size — it should still be identifiable)
- [ ] Signature prop from its spec is present and not duplicated on a sibling
      building (e.g. Woodcutter's round logs vs. Sawpit's planks vs. Woodshed's
      split firewood — three different log shapes, deliberately)
- [ ] Under the stated poly budget
- [ ] No photoreal materials, no pure black/white/neon color
- [ ] Origin point at ground-level center of footprint
- [ ] Animatable parts (windmill sails, market awnings) delivered as separate
      named nodes/submeshes if applicable
