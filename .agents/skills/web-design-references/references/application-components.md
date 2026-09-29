# Application components

Choose the existing primitive family first. Inspect the actual component API before combining examples from different registries; similar names and appearances do not imply compatible composition or state handling.

## shadcn/ui

**Keywords:** React, component foundation, forms, dialogs, navigation, theming, owned source.

**Observed:** [shadcn/ui](https://ui.shadcn.com/) provides composable UI components and a source distribution system. Its [introduction](https://ui.shadcn.com/docs) explains local customization, shared composition conventions, and registry distribution. The site includes application examples, components, blocks, charts, and theming documentation.

**Apply:** Start here when the project already uses shadcn/ui or needs a coherent component foundation. Study the specific control's structure, variants, labeling, and state model, then map it onto the project's existing tokens and wrappers. Use the source to resolve behavior rather than reproducing only the screenshot.

**Limits / access:** It provides a foundation, not a unique product identity. Check the installed configuration and primitive implementation against the current docs. Locally customized source needs deliberate update handling; reinstallation can conflict with project changes.

## coss ui

**Keywords:** Base UI, form composition, validation, accessible primitives, command, combobox.

**Observed:** [coss ui](https://coss.com/ui) builds styled components on Base UI. Its [Field documentation](https://coss.com/ui/docs/components/field) shows label, description, error, validity, and custom-control composition, with source examples and registry installation.

**Apply:** Prefer it when Base UI fits the project, particularly for forms where semantic relationships and validation matter. Borrow the grouping and feedback hierarchy, or adopt a compatible component. Inspect required, invalid, disabled, and custom-control examples for the field being built.

**Limits / access:** Base UI composition is a concrete dependency choice. Compare the API with existing wrappers before reuse; a similar-looking Radix example is not interchangeable. Public docs and source examples are available. Check setup and styling requirements for the selected component.

## ReUI

**Keywords:** admin, dashboard, data grid, filtering, sorting, calendar, kanban, Gantt, uploads.

**Observed:** [ReUI components](https://reui.io/components) emphasizes application workflows beyond basic primitives. The [data-grid catalog](https://reui.io/components/data-grid) includes density, pagination, row selection, column controls, editing, expansion, and loading examples; its documentation discusses TanStack Table state and integration.

**Apply:** Use for a specific data interaction. Compare variants that answer the real problem, such as preserving row identity while sorting or fitting controls around a dense table. Adopt the necessary behavior and density choices, then connect them to the application's data and persistence model.

**Limits / access:** Free component examples and paid blocks coexist. Verify the selected item's availability. Demo filtering, pagination, and editing do not establish a backend contract: decide client versus server operation, dataset scale, and state persistence from project requirements.

## Shadcnblocks

**Keywords:** application shell, sidebar, dashboard, settings, assembled layout.

**Contribution here:** [Shadcnblocks](https://www.shadcnblocks.com/) supplies larger application compositions, including shells, dashboards, tables, and settings surfaces. Use it to study how navigation, page actions, and content fit together beyond a single control.

**Apply:** Select the layout matching the task and content density, then adapt its navigation and responsive grouping to the application's routes. Check the [primitive variants and access notes](marketing.md#shadcnblocks) before importing a block.

## Beautiful UI

**Keywords:** records, table changes, filtering, command search, workspace navigation.

**Contribution here:** [Beautiful UI](https://www.beautifului.dev/) includes record tables, filter tables, search, sidebars, and table diffs within its AI-oriented workspace examples. These are useful references for organizing dense information and making proposed edits inspectable.

**Apply:** Borrow the grouping or change presentation needed by the application. Preserve a useful ordinary workflow even when no assistant is involved. The [source and evidence notes](ai-interfaces.md#beautiful-ui) describe what was inspected.

## beUI

**Keywords:** tabs, command palette, toast stack, bottom sheet, stateful control.

**Contribution here:** [beUI](https://beui.dev/) offers composed controls whose behavior includes content resizing, selection indicators, or dismissal. Use it when a product control needs both a usable state model and a coordinated visual response.

**Apply:** Inspect the specific control's API and keyboard behavior before choosing its animation treatment. Fit it to existing navigation and state ownership. Read the [implementation constraints](motion.md#beui) before reuse.

## Mobbin

**Keywords:** settings hierarchy, onboarding steps, checkout, product workflow, platform comparison.

**Contribution here:** [Mobbin](https://mobbin.com/mcp) contributes examples of how shipped products organize a task across screens, complementing component libraries that begin at the control level.

**Apply:** Resolve the sequence and information hierarchy first, then build it with project components. Inspect adjacent screens when available rather than borrowing an isolated step. See the [access and evidence limits](visual-product.md#mobbin) before relying on gated flows.
