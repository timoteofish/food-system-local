import "../../../shared/i18n/legacy-control.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { getLanguage, getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const createButton = document.getElementById("createBackup");
const backupStatus = document.getElementById("backupStatus");
const backupList = document.getElementById("backupList");
const backupUnits = ["B", "KB", "MB", "GB", "TB"];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>\'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
}[character]));

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";

  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < backupUnits.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formattedSize = new Intl.NumberFormat(getLocale(), {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(size);
  return `${formattedSize} ${backupUnits[unitIndex]}`;
};

const setStatus = (message = "", type = "success") => {
  backupStatus.textContent = message ? translate(message) : "";
  backupStatus.hidden = !message;
  backupStatus.dataset.state = message ? type : "";
};

const renderBackups = (backups) => {
  if (!backups.length) {
    backupList.innerHTML = `<p class="operation-empty">${translate("Nenhum backup disponível")}</p>`;
    return;
  }

  backupList.innerHTML = backups.map((backup) => {
    const name = String(backup.name ?? "");
    const size = formatBytes(backup.size);

    return `
      <article class="backup-entry">
        <div class="backup-entry__details">
          <strong>${escapeHtml(name)}</strong>
          ${size ? `<span>${escapeHtml(size)}</span>` : ""}
        </div>
        <button class="btn btn--secondary" data-restore="${escapeHtml(name)}" type="button">
          ${translate("Restaurar")}
        </button>
      </article>
    `;
  }).join("");
};

const loadBackups = async () => {
  backupList.innerHTML = `<p class="operation-empty">${translate("Carregando backups")}</p>`;
  setStatus();
  try {
    const data = await apiRequest(`/businesses/${businessId}/backups`);
    renderBackups(Array.isArray(data.backups) ? data.backups : []);
  } catch (error) {
    backupList.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(translate("Não foi possível carregar os backups."))}</p><button class="btn btn--secondary" type="button" data-backup-retry>${translate("Tentar novamente")}</button></div>`;
  }
};

backupList.addEventListener("click", (event) => {
  if (event.target.closest("[data-backup-retry]")) void loadBackups();
});

createButton.addEventListener("click", async () => {
  if (createButton.disabled) return;
  createButton.disabled = true;
  setStatus("Criando backup");

  try {
    await apiRequest(`/businesses/${businessId}/backups`, { method: "POST" });
    setStatus("Backup criado");
    await loadBackups();
  } catch (error) {
    setStatus("Não foi possível criar o backup Tente novamente", "error");
  } finally {
    createButton.disabled = false;
  }
});

backupList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-restore]");
  if (!button || button.disabled) return;

  const backupName = button.dataset.restore;
  const confirmation = getLanguage() === "en"
    ? `Restore ${backupName}? Current data will be replaced`
    : `Restaurar ${backupName}? Os dados atuais serão substituídos`;
  if (!window.confirm(confirmation)) return;

  button.disabled = true;
  setStatus("Restaurando backup");
  try {
    await apiRequest(`/businesses/${businessId}/backups/restore`, {
      method: "POST",
      body: { name: backupName },
    });
    setStatus("Backup restaurado Reinicie o aplicativo se necessário");
  } catch (error) {
    setStatus("Não foi possível restaurar o backup Tente novamente", "error");
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

const start = async () => {
  try {
    await initAppShell({ activeNav: "backups" });
    await loadBackups();
  } catch (error) {
    setStatus("Não foi possível abrir os backups", "error");
  }
};

void start();
