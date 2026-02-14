import { createUIOverlay } from "../uiOverlay";
import { registerUiActions, refreshUI } from "./uiActions";
import { isInGame, watchRoutes } from "./routing";

export async function bootApp(): Promise<void> {
  const ui = createUIOverlay();

  registerUiActions(ui);
  await refreshUI(ui);

  watchRoutes(() => {
    ui.setVisible(!isInGame());
  });
}
