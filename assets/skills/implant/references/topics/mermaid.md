# Mermaid diagrams

For any diagram — dependency graphs, call graphs, class hierarchies, flowcharts,
sequence diagrams, state machines, git-style branch graphs — **return a Mermaid fenced
block** (`` ```mermaid ... ``` ``). VS Code's Markdown preview, Copilot Chat, and
GitHub-flavored Markdown all render Mermaid natively — no image generation, no
attachments, no extra dependency.

Do the graph-building (collect nodes, resolve edges, decide layout hints) inside the
snippet, then emit the final Mermaid source as a string.

## Minimal shape

```js
// Return a Markdown string containing a Mermaid fenced block.
const nodes = ["A", "B", "C"];
const edges = [["A", "B"], ["B", "C"]];

const lines = ["```mermaid", "flowchart LR"];
for (const n of nodes) lines.push(`  ${n}`);
for (const [from, to] of edges) lines.push(`  ${from} --> ${to}`);
lines.push("```");
return lines.join("\n");
```

## Common diagram types

- **`flowchart LR|TD|RL|BT`** — dependency graphs, call graphs, generic wiring.
- **`sequenceDiagram`** — control flow, messaging, protocols.
- **`classDiagram`** — inheritance and type hierarchies.
- **`stateDiagram-v2`** — state machines.
- **`gitGraph`** — branch histories.
- **`erDiagram`** — data models.

## Labels and IDs

Mermaid node IDs must be identifier-safe. Sanitize file paths and symbol names before
using them as IDs:

```js
const id = raw.replace(/\W/g, "_");
lines.push(`  ${id}["${raw}"]`); // display label separate from ID
```

## Scale notes

Mermaid tops out well below a thousand nodes; layout gets ugly fast. If you're producing
a very large graph, either group nodes into subgraphs or return a summary table instead.
Reach for a proper graphing tool (e.g., shell out to `graphviz` and return the SVG path)
only when Mermaid genuinely can't handle the size.
