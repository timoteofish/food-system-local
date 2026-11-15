import "../../../shared/i18n/legacy-control.js";
import { apiRequest } from "../../../shared/api/client.js";
import { getSession } from "../../../shared/data/storage.js";
import { getLocale, translate } from "../../../shared/i18n/i18n.js";
import { initAppShell } from "../../../shared/ui/ui.js";

const businessId = getSession()?.businessId;
const createButton = document.getElementById("createBackup");
const createModal = document.getElementById("backupCreateModal");
const confirmCreateButton = document.getElementById("confirmCreateBackup");
const backupStatus = document.getElementById("backupStatus");
const backupList = document.getElementById("backupList");
const backupUnits = ["B", "KB", "MB", "GB", "TB"];
let backupOperationInProgress = false;
let backupListLoadSequence = 0;
let backupPageReady = false;

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

const setStatusText = (message = "", type = "success") => {
  backupStatus.textContent = message;
  backupStatus.hidden = !message;
  backupStatus.dataset.state = message ? type : "";
};

const setBackupActionsDisabled = (disabled) => {
  const locked = disabled || !backupPageReady;
  createButton.disabled = locked;
  confirmCreateButton.disabled = locked;
  backupList.querySelectorAll("[data-restore]").forEach((button) => { button.disabled = locked; });
};

setBackupActionsDisabled(true);

const getBackupLoadError = (error) => error?.apiMessage === "Backup encryption key is not configured"
  ? translate("backupEncryptionKeyRequired")
  : error?.message || translate("loadRetryError");

const getBackupRestoreError = (error) => {
  const messages = {
    "Restore failed; the original database was recovered from its safety backup": "backupRestoreRecovered",
    "Restore failed due to insufficient storage; the original database was recovered": "backupRestoreStorageRecovered",
    "Insufficient storage for restore": "backupRestoreStorageFull",
    "Current database failed integrity validation; a restorable safety backup could not be created": "backupRestoreCurrentInvalid",
    "Restore and automatic recovery failed. The API remains in maintenance; contact support before restarting.": "backupRestoreMaintenance",
    "The backup was restored, but its audit record could not be saved. Check the restore state before retrying.": "backupRestoreAuditUncertain",
    "Backup requires a different application version": "backupRestoreVersionMismatch",
    "Stop the print worker or review an existing restore lock before restoring": "backupRestoreWorkerConflict",
    "Stop the print or backup worker or review an existing restore lock before restoring": "backupRestoreWorkerConflict",
    "Stop print, backup or maintenance workers, or review an existing restore lock before restoring": "backupRestoreWorkerConflict",
    "Stop other API, print, backup or maintenance processes, or review an existing restore lock before restoring": "backupRestoreWorkerConflict",
  };
  const key = messages[error?.apiMessage];
  return key ? translate(key) : error?.message || translate("Could not restore the backup Try again");
};

const renderBackups = (backups) => {
  if (!backups.length) {
    backupList.innerHTML = `<p class="operation-empty">${translate("No backups available")}</p>`;
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
        <button class="btn btn--secondary" data-restore="${escapeHtml(name)}" type="button" ${backupOperationInProgress ? "disabled" : ""}>
          ${translate("Restore")}
        </button>
      </article>
    `;
  }).join("");
};

const loadBackups = async ({ preserveStatus = false } = {}) => {
  const requestSequence = ++backupListLoadSequence;
  backupList.innerHTML = `<p class="operation-empty">${translate("Loading backups")}</p>`;
  if (!preserveStatus) setStatus();
  try {
    const data = await apiRequest(`/businesses/${businessId}/backups`);
    if (requestSequence !== backupListLoadSequence) return;
    renderBackups(Array.isArray(data.backups) ? data.backups : []);
    setBackupActionsDisabled(backupOperationInProgress);
  } catch (error) {
    if (requestSequence !== backupListLoadSequence) return;
    backupList.innerHTML = `<div class="operation-empty" role="alert"><p>${escapeHtml(getBackupLoadError(error))}</p><button class="btn btn--secondary" type="button" data-backup-retry>${translate("Try again")}</button></div>`;
    setBackupActionsDisabled(backupOperationInProgress);
  }
};

backupList.addEventListener("click", (event) => {
  if (event.target.closest("[data-backup-retry]")) void loadBackups();
});

const closeCreateModal = () => {
  createModal.hidden = true;
  document.body.classList.remove("modal-open");
  createButton.focus();
};

createButton.addEventListener("click", () => {
  if (backupOperationInProgress) return;
  createModal.hidden = false;
  document.body.classList.add("modal-open");
  confirmCreateButton.focus();
});

createModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-backup-modal]")) closeCreateModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !createModal.hidden) closeCreateModal();
});

confirmCreateButton.addEventListener("click", async () => {
  if (backupOperationInProgress || confirmCreateButton.disabled) return;
  backupOperationInProgress = true;
  closeCreateModal();
  setBackupActionsDisabled(true);
  setStatus("Creating backup");

  try {
    const result = await apiRequest(`/businesses/${businessId}/backups`, { method: "POST" });
    const warning = result.cleanup_warning && result.audit_recorded === false ? "backupCreatedBothWarnings" : result.cleanup_warning ? "backupCreatedCleanupWarning" : result.audit_recorded === false ? "backupCreatedAuditWarning" : "backupCreatedLocalNotice";
    setStatus(warning, result.cleanup_warning || result.audit_recorded === false ? "error" : "success");
    await loadBackups({ preserveStatus: true });
  } catch (error) {
    setStatus(error?.apiMessage === "Backup encryption key is not configured" ? "backupEncryptionKeyRequired" : error?.apiMessage === "Insufficient storage for backup" ? "backupCreateStorageFull" : error?.apiMessage === "Backup failed integrity validation" ? "backupCreateInvalid" : "Could not create the backup Try again", "error");
  } finally {
    backupOperationInProgress = false;
    setBackupActionsDisabled(false);
  }
});

backupList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-restore]");
  if (!button || button.disabled || backupOperationInProgress) return;

  const backupName = button.dataset.restore;
  const confirmation = `${translate("Restore")} ${backupName}${translate("? Current data will be replaced")}. ${translate("backupStopExternalWorkers")}`;
  if (!window.confirm(confirmation)) return;

  backupOperationInProgress = true;
  setBackupActionsDisabled(true);
  setStatus("Restoring backup");
  try {
    const result = await apiRequest(`/businesses/${businessId}/backups/restore`, {
      method: "POST",
      body: { name: backupName },
    });
    const warning = result.cleanup_warning && result.audit_recorded === false ? "backupRestoreBothWarnings" : result.cleanup_warning ? "backupRestoreCleanupWarning" : result.audit_recorded === false ? "backupRestoreAuditUncertain" : "Backup restored Restart the app if needed";
    setStatus(warning, result.cleanup_warning || result.audit_recorded === false ? "error" : "success");
  } catch (error) {
    setStatusText(getBackupRestoreError(error), "error");
  } finally {
    backupOperationInProgress = false;
    setBackupActionsDisabled(false);
  }
});

const start = async () => {
  try {
    await initAppShell({ activeNav: "backups" });
    backupPageReady = true;
    await loadBackups();
  } catch (error) {
    setStatus("Could not open backups", "error");
  }
};

void start();
