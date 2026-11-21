import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { applyAppearance, cachedAppearance } from "./appearance";

applyAppearance(cachedAppearance());

createRoot(document.getElementById("root")!).render(<App />);
