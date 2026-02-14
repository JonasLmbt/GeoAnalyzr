import { createUIOverlay } from "../uiOverlay";
import { registerUiActions, refreshUI } from "./uiActions";
import { watchRoutes } from "./routing";

export async function bootApp(): Promise<void> {
  const ui = createUIOverlay();

  registerUiActions(ui);
  await refreshUI(ui);

  // Always keep a dashboard trigger available, even on /game routes.
  watchRoutes(() => {
    ui.setVisible(true);
  });
}
