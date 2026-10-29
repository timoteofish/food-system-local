import "../../../shared/i18n/legacy-control.js";
import { checkForSystemUpdates } from "../../../shared/auth/auth.js";
import { getSession } from "../../../shared/data/storage.js";
import { translate } from "../../../shared/i18n/i18n.js";

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
  updateFeedback.dataset.state = "loading";
  updateFeedback.textContent = translate("Verificando atualizações");
  try {
    const result = await checkForSystemUpdates();
    const safeUpdateUrl = typeof result.download_url === "string" && /^https:\/\//i.test(result.download_url)
      ? result.download_url
      : "";
    updateFeedback.dataset.state = result.update_available ? "available" : "success";
    if (result.update_available && safeUpdateUrl) {
      const message = document.createTextNode(
        `${translate(`Versão ${result.available_version} disponível. Abra a página de download para instalar manualmente.`)} `
      );
      const link = document.createElement("a");
      link.href = safeUpdateUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = translate("Baixar atualização");
      updateFeedback.replaceChildren(message, link);
    } else {
      updateFeedback.textContent = result.update_available
        ? translate(`A versão ${result.available_version} está registrada, mas o pacote ainda não foi publicado`)
        : translate(`Você já está usando a versão ${result.current_version}`);
    }
  } catch (error) {
    updateFeedback.dataset.state = "error";
    updateFeedback.textContent = translate("Não foi possível verificar atualizações");
  } finally {
    checkUpdateButton.disabled = false;
  }
});
