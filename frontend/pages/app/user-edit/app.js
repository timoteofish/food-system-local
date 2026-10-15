import { logout } from "../../../shared/auth/auth.js";
import { getSession } from "../../../shared/data/storage.js";

const session = getSession() || {};
const avatarInput = document.getElementById("userAvatarInput");
const avatarButton = document.getElementById("userAvatarButton");
const avatarPreview = document.getElementById("userAvatarPreview");
const avatarPlaceholder = document.getElementById("userAvatarPlaceholder");
const nameInput = document.getElementById("userName");
const emailInput = document.getElementById("userEmail");
const phoneInput = document.getElementById("userPhone");

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

document.querySelectorAll("[data-action='logout']").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    logout().finally(() => {
      window.location.href = "../../auth/login/index.html";
    });
  });
});
