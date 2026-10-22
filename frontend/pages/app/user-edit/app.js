import "../../../shared/i18n/legacy-control.js";
import { checkForSystemUpdates } from "../../../shared/auth/auth.js";
import { getSession } from "../../../shared/data/storage.js";

const session = getSession() || {};
const avatarInput = document.getElementById("userAvatarInput");
const avatarButton = document.getElementById("userAvatarButton");
const avatarPreview = document.getElementById("userAvatarPreview");
const avatarPlaceholder = document.getElementById("userAvatarPlaceholder");
const nameInput = document.getElementById("userName");
const emailInput = document.getElementById("userEmail");
const phoneInput = document.getElementById("userPhone");
const checkUpdateButton = document.getElementById("checkUpdateButton");
const updateFeedback = document.getElementById("updateFeedback");

const initials = String(session.name || session.email || "U")
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part[0])
  .join("")
  .toUpperCase();

if (nameInput) nameInput.value = session.name || "";
if (emailInput) emailInput.value = session.email || "";
if (phoneInput) phoneInput.value = session.phone || "";
if (avatarPlaceholder) avatarPlaceholder.textContent = initials || "U";

avatarButton?.addEventListener("click", () => avatarInput?.click());

avatarInput?.addEventListener("change", () => {
  const file = avatarInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (avatarPreview) {
      avatarPreview.src = String(reader.result || "");
      avatarPreview.hidden = false;
    }
    if (avatarPlaceholder) {
      avatarPlaceholder.hidden = true;
    }
  };
  reader.readAsDataURL(file);
});

document.querySelectorAll("[data-action='close-app']").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
    if (tauriWindow) void tauriWindow.close();
    else window.close();
  });
});

checkUpdateButton?.addEventListener("click", async () => {
  checkUpdateButton.disabled = true;
  updateFeedback.hidden = false;
  updateFeedback.textContent = "Verificando atualizações...";
  try {
    const result = await checkForSystemUpdates();
    updateFeedback.textContent = result.update_available
      ? result.download_url
        ? `Versão ${result.available_version} disponível. Abra o link para atualizar quando quiser.`
        : `A versão ${result.available_version} está registrada, mas o pacote ainda não foi publicado.`
      : `Você já está usando a versão ${result.current_version}.`;
  } catch (error) {
    updateFeedback.textContent = error?.message || "Não foi possível verificar atualizações.";
  } finally {
    checkUpdateButton.disabled = false;
  }
});
