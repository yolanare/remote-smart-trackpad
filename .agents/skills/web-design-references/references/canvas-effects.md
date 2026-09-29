# Canvas effects

## Canvas UI

**Keywords:** WebGL, WebGPU, HTML-in-canvas, particles, glass, distortion, shader, creative coding.

**Observed:** [Canvas UI](https://canvasui.dev/) offers source components for effects such as liquid, glass, shatter, and particle reveal, in several framework variants and vanilla TypeScript. Its FAQ distinguishes experimental live HTML-in-canvas behavior from GPU overlays and ordinary HTML fallback. The page advertises a shadcn-compatible registry and describes reduced-motion handling and off-screen pausing.

**Apply:** Use when a GPU effect contributes to a specific visual idea: a reveal, material treatment, or interactive showcase. Inspect the selected effect and framework variant, then establish its browser capability requirements. Keep meaningful content and controls available in the normal HTML presentation. Verify the fallback before refining the enhanced effect.

**Limits / access:** Browser support differs by effect and renderer; the site's broad support claims need checking against the selected implementation and target devices. A flag-dependent demonstration is not a production requirement. Measure actual responsiveness and resource use. The FAQ states MIT plus Commons Clause terms with restrictions on redistributing the components; inspect the current license before reuse. Public documentation was reviewed, not GPU runtime behavior.

## Aceternity UI

**Keywords:** shader background, procedural clouds, dithering, image treatment, canvas reveal.

**Contribution here:** [Aceternity UI](https://ui.aceternity.com/components) lists shader and canvas examples such as cloud backgrounds, dithering, and reveals. These are starting points for a particular texture or image treatment within an interface.

**Apply:** Inspect the individual implementation to identify its renderer and dependencies; the catalog also contains CSS and SVG effects. Choose the simplest renderer that achieves the requested treatment and verify its static fallback. Read the [reuse constraints](marketing.md#aceternity-ui) before importing source.

## Rare UI

**Keywords:** WebGL orb, fluid shading, ambient rendering, still frame.

**Contribution here:** [Rare UI's Fluid Orb](https://rareui.com/components/fluidorb) offers a contained WebGL example with configurable size and color. It is useful for studying a self-contained animated material rather than applying an effect to arbitrary page content.

**Apply:** Inspect rendering lifecycle, sizing, and reduced-motion behavior in the chosen source. Check resource cleanup when the visual is removed and provide an appropriate fallback. Consult the [license and evidence limits](motion.md#rare-ui) before copying it.
