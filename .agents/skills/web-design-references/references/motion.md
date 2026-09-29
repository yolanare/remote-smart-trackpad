# Motion and microinteractions

Choose the branch that resolves the uncertainty: whether to animate, how to implement a transition, or how an observed interaction unfolds.

## Emil Kowalski

**Keywords:** purposeful motion, frequency, perceived speed, keyboard, tooltip, restraint.

**Observed:** [You Don't Need Animations](https://emilkowal.ski/ui/you-dont-need-animations) evaluates animation through purpose, frequency of use, and perceived responsiveness. Examples contrast occasional expressive feedback with frequently repeated command interactions, and distinguish initial tooltip delay from moving between already-active tooltips.

**Apply:** Before adding motion, identify the information it communicates and how often the user repeats the action. Prefer immediate feedback for rapid keyboard navigation. Use spatial continuity when it clarifies an appearance, dismissal, or state change. Treat the article's timing examples as starting points to compare in context.

**Limits / access:** Public article with interactive examples. This is decision guidance, not a component library. Its recommendations are contextual; a marketing sequence and a high-frequency application control have different jobs. Text extraction conveys the argument but does not substitute for experiencing the demos.

## Transitions.dev

**Keywords:** CSS, React, menu, modal, resize, toast, tabs, state transition.

**Observed:** [Transitions.dev](https://transitions.dev/) presents focused transition recipes with CSS/React views: origin-aware menus, resizing cards, panel reveals, text swaps, sliding indicators, and loading-to-content changes. The site also advertises a motion agent and paid features.

**Apply:** Use when the control already exists and a particular transition needs refinement. Inspect the matching recipe's trigger, origin, animated properties, entrance, and exit. Adapt it to the existing control's state and motion tokens. Try a quick reversal while it is moving to expose jumps or stale state.

**Limits / access:** Inspect the recipe's access level and implementation before reuse. The separate agent, CLI, and scoring workflow are optional products, not prerequisites for using a visual reference. A motion score does not establish that every control benefits from animation.

## beUI

**Keywords:** React, Motion, animated controls, morphing modal, toast stack, tabs, bottom sheet.

**Observed:** [beUI](https://beui.dev/) supplies animated React/Next.js components using Motion and Tailwind, with source distributed through shadcn conventions. Its catalog includes morphing modal panels, stateful buttons, toast stacks, tabs, command palettes, and draggable sheets; the site describes controlled-state and keyboard features for some components.

**Apply:** Choose it when motion is part of a control's behavior, rather than an isolated entrance effect. Study how panel size follows content, how an active indicator tracks selection, or how a toast dismisses. Connect the animation to real component state and exercise interrupted transitions.

**Limits / access:** Check the chosen component's React, Tailwind, and Motion requirements. Accessibility descriptions on individual examples are not an audit of the complete library or your adaptation. Free source and a separate Pro offering coexist.

## Rare UI

**Keywords:** unusual widget, animated sidebar, duration picker, progress player, fluid orb, tactile detail.

**Observed:** [Rare UI](https://www.rareui.com) offers individual animated React components. The indexed official [Fluid Orb](https://rareui.com/components/fluidorb) describes an ambient WebGL effect and a reduced-motion still frame; [Step player](https://www.rareui.com/components/stepplayer) exposes controlled progress and playback options.

**Apply:** Use for a distinctive, localized interaction after the basic interface is settled. Inspect the specific widget's state model and interaction type; an ambient orb, for example, needs a separate meaningful status label if used in a voice interface.

**Limits / access:** Homepage opening failed during review; official indexed pages supplied the evidence. This is `rareui.com`, distinct from `rareui.in`. The retrieved pages had differing license wording; newer entries require attribution and restrict component redistribution under additional terms. Verify the current repository license before copying. Source buttons, visuals, and runtime behavior were not exercised.

## 60fps

**Keywords:** interaction recording, iOS, spring, gesture, bottom sheet, shared element, motion analysis, MCP.

**Observed:** [60fps MCP](https://60fps.design/mcp) describes searching recorded iOS interactions, retrieving shot details, and obtaining motion breakdowns. Its advertised code output is SwiftUI. The [public filter catalog](https://60fps.design/shots/filter) groups examples by gestures, patterns, effects, and elements.

**Apply:** Use when screenshots cannot answer how an interaction unfolds. Identify trigger, starting state, movement, settling, and purpose. Translate those relationships into browser-appropriate behavior, including pointer and keyboard equivalents. Treat numerical timing as measured only when the available evidence supplies it.

**Limits / access:** This is chiefly a native-mobile reference, not a web component registry. MCP requires suitable account access; plan wording can change, so verify eligibility on the current MCP page. Without a connected tool, use accessible recordings or choose a web recipe. No private MCP results were inspected during this review.

## Magic UI

**Keywords:** animated list, orbit, marquee, coordinated sequence, repeated motion.

**Contribution here:** [Magic UI](https://magicui.design/docs/components) provides examples of movement across multiple elements: lists appearing over time, orbiting compositions, and repeating strips. These help study sequencing and rhythm within a bounded visual.

**Apply:** Inspect how the chosen example starts, repeats, and settles. Adapt its timing to the information being shown and verify that reading remains comfortable. See the [stack and access notes](marketing.md#magic-ui) before adopting source.

## Aceternity UI

**Keywords:** scroll-linked motion, parallax, hover depth, text reveal, pointer response.

**Contribution here:** [Aceternity UI](https://ui.aceternity.com/components) illustrates motion tied to scrolling or pointer position, including parallax, card depth, and progressive reveals. Use it to understand the relationship between input and visual response.

**Apply:** Keep interaction feedback predictable when direction changes, the pointer leaves, or the input device changes. Verify the non-hover and reduced-motion presentation. Consult the [implementation constraints](marketing.md#aceternity-ui) for dependency and performance considerations.

## UI Skills

**Keywords:** motion audit, animation review, interaction principles, performance analysis.

**Contribution here:** [UI Skills](https://www.ui-skills.com/) indexes animation and interaction methods, including reviews of an existing codebase. It is useful when the problem is inconsistent or ineffective motion across a surface rather than a missing effect.

**Apply:** Choose a method that matches diagnosis, planning, or implementation as requested. Use its findings to prioritize concrete interactions. Check the [method-selection notes](foundations.md#ui-skills), especially whether the selected skill only produces a plan.
