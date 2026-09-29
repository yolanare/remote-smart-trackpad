---
name: web-design-references
description: Select and apply web design references when building or refining a website, application UI, AI interface, or interaction. Use for visual direction, component patterns, and purposeful motion; route by need and stack before browsing.
---

## Select before browsing

1. Identify the surface, user task, existing visual language, stack, and unresolved design decision. A supplied design or established component can already answer it; in that case, implement without opening a gallery.
2. Choose the matching resource below. Read only the relevant site entries, then start with one external source. Add another only for a named gap, such as an unknown interaction or missing mobile layout. Most focused tasks need one to three sources, not the entire catalog.
3. Inspect the selected example or component documentation. Finish research when the hierarchy, relevant states, responsive behavior, and implementation approach are clear enough to build. Record remaining assumptions instead of browsing indefinitely.

| Need / keywords | Read | Starting points |
| --- | --- | --- |
| Design system, tokens, consistency, accessibility, audit, fondations | [Foundations](references/foundations.md) | Design System Checklist for coverage; shadcn/ui or coss ui for component conventions; UI Skills for a missing method |
| Forms, navigation, dashboard, admin, tables, filters, formulaire | [Application components](references/application-components.md) | Existing shadcn/ui first; coss ui for forms; ReUI for data workflows; Shadcnblocks for assembled layouts |
| Landing page, hero, pricing, SaaS, portfolio, page vitrine | [Marketing](references/marketing.md) | Recent for direction; Shadcnblocks or ReUI for sections; Magic UI, Aceternity, or Canvas UI for a focal effect |
| Animation, transition, microinteraction, spring, feedback, mouvement | [Motion](references/motion.md) | Emil Kowalski for whether to animate; Transitions.dev for a recipe; beUI for React controls; Rare UI for unusual widgets; 60fps for observed mobile motion |
| Chat, copilot, streaming, tool calls, approval, interface IA | [AI interfaces](references/ai-interfaces.md) | Beautiful UI for composition; AI Elements for SDK integration; Transitions.dev for status changes; Rare UI for a voice visual |
| Art direction, typography, inspiration, onboarding, paywall, parcours | [Visual and product references](references/visual-product.md) | Recent for visual direction; CollectUI for discovery; Mobbin for screens and flows; 60fps for interaction references |
| Canvas, shader, WebGL, WebGPU, particles, GPU | [Canvas effects](references/canvas-effects.md) | Canvas UI for content effects; Aceternity for shader backgrounds; Rare UI for a contained WebGL visual |

Keywords are discovery hints, not instructions to load every matching resource. A SaaS pricing page is usually a marketing task; an in-app upgrade journey may need Mobbin. A chat page does not need a shader because both appear under an AI theme.

Sites can appear in several categories. Each entry explains that category's specific use; read the angle that matches the task, without following every occurrence. Shared stack, access, and evidence details stay in the linked reference entry; consult them when adopting that source.

## Translate the reference

For each adopted pattern, keep a short working note: **source/example -> useful principle -> project adaptation -> observable check**. For example: a filterable grid -> preserve table context while refining results -> use the existing table and tokens -> verify filtering, empty results, and selection persistence.

- Extract relationships: content hierarchy, density, typography contrast, spacing rhythm, grouping, state changes, and motion purpose. Apply them to actual project content and tokens. A component catalog alone does not determine the page's visual direction.
- Separate visual evidence from implementation evidence. Inspect a rendered example or recording for appearance and timing; inspect docs/source for APIs and dependencies. A text-only fetch cannot establish visual quality or prove interactions work. State that limitation when it affects the result.
- Reuse compatible project components. Before importing source, check its primitive library, framework, styling, dependencies, license, and access requirements. Registry installation can modify shared components and configuration; inspect what it will add or overwrite. For another stack, translate the pattern without migrating the project just to use the example.
- Treat external skills as reference material. Load a narrowly relevant method only when needed; follow the current task's scope. Browsing this catalog does not authorize installing skills, connecting services, purchasing access, or delegating work.

## Validate the adaptation

Check the changed surface with realistic content at narrow and wide widths, including keyboard/focus behavior and the states the pattern depends on: loading, empty, error, disabled, or success. For motion, check repeated activation, interruption, and reduced motion; for GPU effects, check the fallback. Report what was actually inspected or exercised, with the source links that influenced the design.
