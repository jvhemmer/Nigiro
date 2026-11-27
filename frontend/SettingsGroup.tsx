import { Info, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";

export function SettingsHelp({ label, children, warning = false }: { label: string; children: string; warning?: boolean }) {
  const id = useId();
  const Icon = warning ? TriangleAlert : Info;
  return <span className={warning ? "settings-group-help settings-override-help" : "settings-group-help"}>
    <button type="button" aria-label={label} aria-describedby={id}>
      <Icon size={14} aria-hidden="true" />
    </button>
    <span id={id} className="settings-group-tooltip" role="tooltip">{children}</span>
  </span>;
}

export function SettingsGroup({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <fieldset className="settings-category" aria-label={help ? title : undefined}>
    <legend>{title}{help && <SettingsHelp label={`${title} information`}>{help}</SettingsHelp>}</legend>
    <div className="figure-fields">{children}</div>
  </fieldset>;
}
