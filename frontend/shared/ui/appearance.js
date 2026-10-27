export const applyAppearancePreferences = () => {
  let theme = "light";
  let motionPreference = "system";
  let textSize = "normal";
  let highContrast = false;
  try {
    theme = localStorage.getItem("food-system-theme") || "light";
    motionPreference = localStorage.getItem("food-system-reduced-motion") || "system";
    textSize = localStorage.getItem("food-system-text-size") || "normal";
    highContrast = localStorage.getItem("food-system-high-contrast") === "true";
  } catch {
    // Use the readable light theme and device defaults when storage is unavailable.
  }

  const resolvedTheme = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  const reducedMotion = motionPreference === "reduced" || (
    motionPreference === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.dataset.reducedMotion = String(reducedMotion);
  document.documentElement.dataset.textSize = textSize === "large" ? "large" : "normal";
  document.documentElement.dataset.highContrast = String(highContrast);
  document.documentElement.style.colorScheme = resolvedTheme;
};

export const initializeAppearancePreferences = () => {
  if (document.documentElement.dataset.themeBooted === "true") return;
  document.documentElement.dataset.themeBooted = "true";
  applyAppearancePreferences();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (document.documentElement.dataset.themePreference === "system") applyAppearancePreferences();
  });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => {
    try {
      if ((localStorage.getItem("food-system-reduced-motion") || "system") === "system") {
        applyAppearancePreferences();
      }
    } catch {
      applyAppearancePreferences();
    }
  });
};
