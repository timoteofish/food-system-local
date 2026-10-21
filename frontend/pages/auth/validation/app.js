import { completeRegistration } from "../../../shared/auth/auth.js";
import { getPendingRegistration, savePendingRegistration } from "../../../shared/data/storage.js";

const pending = getPendingRegistration();

if (!pending?.email || !pending?.password) {
  window.location.replace("../register/index.html");
}

const form = document.getElementById("validationForm");
const businessNameInput = document.getElementById("businessName");
const photoInput = document.getElementById("companyPhoto");
const photoPreview = document.getElementById("companyPhotoPreview");
const photoPlaceholder = document.getElementById("companyPhotoPlaceholder");
const feedback = document.getElementById("validationFeedback");

let companyPhoto = pending?.businessAvatar || "";

const showFeedback = (message) => {
  if (!feedback) return;
  feedback.textContent = message;
  feedback.hidden = false;
};

const syncPreview = () => {
  const name = businessNameInput.value.trim() || pending?.name || "Food System";
  photoPlaceholder.textContent = name.slice(0, 1).toUpperCase();

  if (companyPhoto) {
    photoPreview.src = companyPhoto;
    photoPreview.hidden = false;
    photoPlaceholder.hidden = true;
  } else {
    photoPreview.hidden = true;
    photoPreview.removeAttribute("src");
    photoPlaceholder.hidden = false;
  }
};

businessNameInput.value = pending?.businessName || pending?.name || "";
syncPreview();

businessNameInput.addEventListener("input", syncPreview);

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showFeedback("Escolha um arquivo de imagem.");
    photoInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    companyPhoto = String(reader.result || "");
    feedback.hidden = true;
    syncPreview();
  };
  reader.readAsDataURL(file);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const businessName = businessNameInput.value.trim();
  if (!businessName) {
    showFeedback("Informe o nome da empresa para continuar.");
    businessNameInput.focus();
    return;
  }

  savePendingRegistration({
    ...pending,
    businessName,
    businessAvatar: companyPhoto,
    validatedAt: new Date().toISOString(),
  });

  try {
    await completeRegistration();
    window.location.href = "../../app/dashboard/index.html";
  } catch (error) {
    showFeedback(error?.message || "Não foi possível concluir o cadastro.");
  }
});
