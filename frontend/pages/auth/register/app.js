import { loginWithFirebaseGoogle, saveRegistrationStep } from "../../../shared/features/auth/index.js";
import { TERMS_SECTIONS } from "../terms/terms-data.js";
import { translate } from "../../../shared/i18n/i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("registerForm");
  const terms = document.getElementById("termos");
  const submit = form.querySelector(".btn--primary");
  const passwordInput = document.getElementById("registerPassword");
  const confirmInput = document.getElementById("confirmar_senha");
  const errorMessage = document.getElementById("senhaErro");
  const feedback = document.getElementById("registerFeedback");
  const termsModal = document.getElementById("termsModal");
  const termsBody = document.getElementById("termsBody");
  const openTerms = document.getElementById("openTerms");

  const renderTerms = () => {
    if (!termsBody) return;
    termsBody.innerHTML = TERMS_SECTIONS.map((section) => `
      <section class="terms-section">
        <h3>${translate(section.title)}</h3>
        <ul>
          ${section.items.map((item) => `<li>${translate(item)}</li>`).join("")}
        </ul>
      </section>
    `).join("");
  };

  const openTermsPanel = () => {
    renderTerms();
    termsModal.hidden = false;
    document.body.classList.add("modal-open");
  };

  const closeTermsPanel = () => {
    termsModal.hidden = true;
    document.body.classList.remove("modal-open");
  };

  const updateSubmitState = () => {
    submit.disabled = !terms.checked;
  };

  updateSubmitState();
  terms.addEventListener("change", updateSubmitState);

  confirmInput.addEventListener("input", () => {
    errorMessage?.classList.remove("is-visible");
  });

  openTerms?.addEventListener("click", openTermsPanel);
  termsModal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-action='close-terms']")) {
      closeTermsPanel();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && termsModal && !termsModal.hidden) {
      closeTermsPanel();
    }
  });

  const showFeedback = (message) => {
    if (!feedback) return;
    feedback.textContent = translate(message);
    feedback.className = "form-feedback form-feedback--error";
    feedback.hidden = false;
  };

  const googleBtnContainer = document.getElementById("googleSignInBtnRegister");
  if (googleBtnContainer) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", translate("Registrar com Google"));
    button.className = "google-icon-btn";
    button.innerHTML = `
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" width="22" height="22">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
        <path fill="#b4232f" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
        <path fill="#b4232f" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
      </svg>
    `;
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        await loginWithFirebaseGoogle();
        window.location.href = "../../app/dashboard/index.html";
      } catch (error) {
        showFeedback(error.message || "Não foi possível criar a conta com o Google");
        button.disabled = false;
      }
    });
    googleBtnContainer.replaceChildren(button);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!terms.checked) {
      showFeedback("É necessário concordar com os termos de serviço");
      return;
    }

    const name = document.getElementById("nome").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    if (!name || !email || !password) {
      showFeedback("Preencha todos os campos obrigatórios");
      return;
    }

    if (password.length < 6) {
      showFeedback("A senha deve ter pelo menos 6 caracteres");
      return;
    }

    if (password !== confirmPassword) {
      errorMessage?.classList.add("is-visible");
      confirmInput.focus();
      return;
    }

    try {
      saveRegistrationStep({ name, email, password });
      window.location.href = "../validation/index.html";
    } catch (error) {
      showFeedback(error.message || "Não foi possível salvar o cadastro");
    }
  });
});
