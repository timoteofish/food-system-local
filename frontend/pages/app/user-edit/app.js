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
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    avatarInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 12_000 || image.naturalHeight > 12_000 || image.naturalWidth * image.naturalHeight > 40_000_000) return;
      const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (avatarPreview) {
        avatarPreview.src = canvas.toDataURL("image/jpeg", 0.82);
        avatarPreview.hidden = false;
      }
      if (avatarPlaceholder) avatarPlaceholder.hidden = true;
    };
    image.src = String(reader.result || "");
  };
  avatarInput.value = "";
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
