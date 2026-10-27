import { requireAuth } from "../auth/auth.js";
import { initProfileMenu } from "./ui.js";
import { initializeAppearancePreferences } from "./appearance.js";

initializeAppearancePreferences();

const initializeProfileMenu = () => {
  if (!document.querySelector(".profile .profile-btn")) return;
  requireAuth();
  initProfileMenu();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeProfileMenu, { once: true });
} else {
  initializeProfileMenu();
}
