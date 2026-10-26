import { translate } from "../../../shared/i18n/i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("recoverForm");
  const feedback = document.getElementById("recoverFeedback");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    if (!email) {
      feedback.textContent = translate("Informe um e-mail válido");
      feedback.className = "form-feedback form-feedback--error";
      feedback.hidden = false;
      return;
    }

    feedback.textContent =
      translate("Se existir uma conta com este e-mail, enviaremos instruções de redefinição em breve");
    feedback.className = "form-feedback form-feedback--success";
    feedback.hidden = false;
    form.reset();
  });
});
