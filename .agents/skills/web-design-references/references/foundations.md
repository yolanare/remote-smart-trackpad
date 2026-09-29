# Foundations and design methods

Use for system consistency or a specific design knowledge gap. A small visual change rarely needs a full design-system review.

## Design System Checklist

**Keywords:** design system, tokens, color, typography, spacing, breakpoints, maintenance, coherence.

**Observed:** [Design System Checklist](https://www.designsystemchecklist.com/) is a planning and review resource. Its [official source data](https://github.com/ardakaracizmeli/design-system-checklist/tree/master/src/data) separates design language, foundations, components, and maintenance. The [foundation data](https://raw.githubusercontent.com/ardakaracizmeli/design-system-checklist/master/src/data/designFoundations.js) includes semantic color, dark mode, layout units, grids, spacing, and responsive breakpoints, with references to established systems.

**Apply:** Use the relevant section to uncover missing decisions behind inconsistent screens. For a theme, map semantic roles across modes; for responsive layout, identify the shared grid and spacing rules. Produce a scoped gap list tied to actual components, then fix the decisions affecting the requested surface.

**Limits / access:** The public page exposed only its shell in text extraction; the linked repository provided the category and foundation evidence. Read the applicable source section if rendering fails. This is a coverage checklist, not a ready-made visual style or certification of accessibility.

## UI Skills

**Keywords:** design engineering, UI polish, accessibility, visual hierarchy, interaction, performance, agent methods.

**Observed:** [UI Skills](https://www.ui-skills.com/) catalogs agent skills by topic, alongside design references and short implementation lessons. Entries distinguish activities such as UI auditing, visual creation, animation review, and React performance review. Some explicitly produce plans without modifying application code.

**Apply:** Search for the missing capability, then read that entry's scope and original source. For example, a spacing and typography problem calls for visual polish guidance; a motion performance problem calls for animation analysis. Extract the method that resolves the current decision.

**Limits / access:** This is a directory of methods, not a component library. Its entries come from different authors and can impose different workflows or stack assumptions. Select one relevant method instead of accumulating overlapping skill bundles. CLI and MCP discovery are advertised, but ordinary page access is enough to assess relevance.

## shadcn/ui

**Keywords:** component architecture, variants, theming, composition, design-system implementation.

**Contribution here:** [shadcn/ui](https://ui.shadcn.com/docs) helps turn visual rules into a component system the project owns. Study how shared composition and customization conventions keep controls coherent as the interface grows.

**Apply:** Define reusable variants and token mappings across the controls in scope. Resolve competing button or field conventions at the shared component level. For integration and update constraints, read the [component reference](application-components.md#shadcnui).

## coss ui

**Keywords:** Base UI, field anatomy, labeling, validation conventions, semantic structure.

**Contribution here:** [coss ui](https://coss.com/ui/docs/components/field) provides a concrete reference for the anatomy of a form field: control, label, help, error, and validity. This supports consistent behavior as well as consistent appearance.

**Apply:** Establish one field composition across forms, including how custom controls join the validation context. Check the [Base UI integration constraints](application-components.md#coss-ui) before adopting its wrappers.

## Emil Kowalski

**Keywords:** motion policy, interaction frequency, responsiveness, design principles.

**Contribution here:** [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) informs a system-wide motion policy: distinguish frequent task execution from occasional expressive moments.

**Apply:** Define which interaction families respond immediately and which benefit from continuity or explanation. Use that policy to resolve inconsistent animation choices across components. Consult the [motion entry](motion.md#emil-kowalski) for applying the article to an individual interaction.
