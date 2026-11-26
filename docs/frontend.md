# Frontend development

## Color controls

Use the shared picker for desktop color fields, including line colors, legend frames, and figure backgrounds. In Figure Settings, use `FigureColorField` to connect the picker to its label and the global value actions. In Inspect, place `ColorField` inside `InspectField` and pass it the field ID. [Shared picker](../frontend/ColorField.tsx)

Store colors as six-digit hex strings or the literal `transparent`. Use `plotlyColor` to convert transparency when building a Plotly figure. Set `opaque` only for settings that require a solid color, such as the UI accent.

## Trace legend controls

In Inspect, **Show in legend** and **Legend desc.** use the same Apply action as line and fill edits. Keep both values as per-trace overrides so a user can revert either field independently. Apply the overrides when building the trace presentation so the preview and export use the same legend. [Inspect form](../frontend/App.tsx) · [Trace presentation](../frontend/FitPlot.tsx)

Keep the figure-wide legend position separate from trace visibility. In **Auto**, an explicit **Show in legend** can display a legend for a single line. **Hidden** suppresses the entire legend. Format descriptions with the figure's legend renderer. **Auto** prefers inline math for both `$…$` and `$$…$$`. [Legend text formatter](../frontend/plotText.mjs)
