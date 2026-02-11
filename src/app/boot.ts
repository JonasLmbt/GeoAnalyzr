import { createUI } from "../ui.legacy";
import { registerUiActions, refreshUI } from "./uiActions";
import { isInGame, watchRoutes } from "./routing";

export async function bootApp(): Promise<void> {
  const ui = createUI();

  registerUiActions(ui);
  await refreshUI(ui);

  watchRoutes(() => {
    ui.setVisible(!isInGame());
  });
}
