# AI interfaces

Match the visual components to real backend states. Separate pending work, streaming, approval, completion, cancellation, and failure where the product supports them. Render actual events, sources, or supplied reasoning summaries rather than fabricated progress, citations, or hidden reasoning.

## Beautiful UI

**Keywords:** AI workspace, approval card, tool status, prompt composer, context, proposed diff.

**Observed:** [Beautiful UI](https://www.beautifului.dev/) presents primitives specifically for AI interfaces: loading and thinking displays, streaming answers, approval cards, tool chips, task rows, chat, prompt input, source context, and proposed changes to tables. Its examples show how these pieces coexist in a working surface.

**Apply:** Use when deciding how an assistant's activity should be understood and controlled. Borrow information grouping: keep a proposed action and its approval together, make tool results distinguishable from status, and place source context near the answer it supports. A diff view can make generated changes reviewable before application.

**Limits / access:** Public examples were inspected through page content, not runtime interaction. The footer links an MIT license, but implementation and integration details must be checked on the selected source. This catalog does not establish compatibility with a particular model SDK or supply the application's execution logic.

## AI Elements

**Keywords:** AI SDK, shadcn/ui, React, conversation, streaming, sources, tool calls, voice, workflow.

**Observed:** [AI Elements](https://elements.ai-sdk.dev/) combines composable UI with AI SDK integration. Components cover conversation, input, messages, sources, tool activity, confirmations, code, voice, and workflows. Its [setup documentation](https://elements.ai-sdk.dev/docs/setup) specifies a React/shadcn/Tailwind environment with AI SDK configuration and gives Next.js setup guidance.

**Apply:** Prefer this source when the project already uses the compatible stack and needs implementation patterns for message parts, streaming status, or tools. Read the specific component documentation and integration example. Map its states to the application's request lifecycle, including stop, retry, and approval where applicable.

**Limits / access:** Check current prerequisites against the installed versions; avoid upgrading or introducing an entire stack merely for one visual pattern. The recommended model gateway is a separate architecture decision. UI components alone do not supply persistence, authorization, or tool execution. For a different stack, use the interaction model as reference and implement locally.

## Transitions.dev

**Keywords:** streaming text, thinking status, loader, completion feedback, changing message.

**Contribution here:** [Transitions.dev](https://transitions.dev/) includes thinking states, streaming-text treatments, text-state swaps, and loading transitions. These can make changes during an asynchronous response easier to follow.

**Apply:** Tie each transition to an actual request event. Keep streamed text readable and support stopping or failing partway through a transition. Consult the [recipe and access notes](motion.md#transitionsdev); animation does not supply the request lifecycle.

## Rare UI

**Keywords:** voice assistant, ambient orb, assistant presence, voice-mode visual.

**Contribution here:** [Rare UI's Fluid Orb](https://rareui.com/components/fluidorb) is a reference for an ambient voice-interface visual. Its changing material and color can give an assistant a visual presence without occupying the conversation area.

**Apply:** Pair the visual with explicit listening, processing, speaking, or inactive labels backed by real application state. The orb is ambient by default; state or audio reactivity needs separate implementation. Read the [source, attribution, and evidence limits](motion.md#rare-ui) before reuse.
