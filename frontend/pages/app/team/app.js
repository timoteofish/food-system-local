import {
  disableTeamMemberRemote,
  inviteTeamMemberRemote,
  loadTeamMembersRemote,
  updateTeamMemberRemote,
} from "../../../shared/auth/auth.js";
import { getBusiness } from "../../../shared/data/storage.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";
import { escapeHtml } from "../../../shared/utils/utils.js";
import { translate } from "../../../shared/i18n/i18n.js";

const roleLabels = {
  owner: "teamRoleOwner",
  manager: "teamRoleManager",
  staff: "teamRoleStaff",
};

const getRoleLabel = (role) => translate(roleLabels[role] || roleLabels.staff);
let appShellReady = false;

const statusLabels = {
  active: "teamStatusActive",
  inactive: "teamStatusInactive",
  pending: "teamStatusPending",
};

const state = {
  members: [],
  loading: false,
};

const elements = {
  form: document.getElementById("teamInviteForm"),
  name: document.getElementById("memberName"),
  role: document.getElementById("memberRole"),
  list: document.getElementById("teamList"),
  count: document.getElementById("teamCount"),
};
const pageLoading = document.getElementById("teamPageLoading");
const errorModal = document.getElementById("teamErrorModal");
const loadErrorMessage = document.getElementById("teamLoadError");
const retryButton = document.getElementById("teamRetry");
const errorClose = document.getElementById("teamErrorClose");

const setLoading = (isLoading) => {
  pageLoading.hidden = !isLoading;
  if (isLoading) {
    pageLoading.querySelector("[data-team-loading-label]").textContent = translate("Loading");
  }
};

const hideLoadError = () => {
  errorModal.hidden = true;
  document.body.classList.remove("modal-open");
};

const showLoadError = (message) => {
  setLoading(false);
  loadErrorMessage.textContent = message;
  retryButton.disabled = false;
  errorModal.hidden = false;
  document.body.classList.add("modal-open");
  errorClose.focus();
};

errorModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-team-error]")) hideLoadError();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) hideLoadError();
});

const businessId = () => getBusiness()?.id;

const renderTeam = () => {
  elements.list.setAttribute("aria-busy", "false");
  const activeCount = state.members.filter((member) => member.status === "active").length;
  const countKey = activeCount === 1 ? "teamCountSingle" : "teamCountPlural";
  elements.count.textContent = translate(countKey).replace("$1", String(activeCount));

  if (!state.members.length) {
    elements.list.innerHTML = `<div class="team-empty">${translate("teamNoMembers")}</div>`;
    return;
  }

  elements.list.innerHTML = state.members.map((member) => {
    const name = escapeHtml(member.user?.name || translate("teamNoName"));
    const email = String(member.user?.email || "").trim();
    const role = escapeHtml(member.role || "staff");
    const status = Object.hasOwn(statusLabels, member.status) ? member.status : "unknown";
    const id = escapeHtml(member.id);
    const disabled = role === "owner" ? "disabled" : "";

    const roleOptions = Object.entries(roleLabels).map(([value, label]) => (
      `<option value="${value}" ${value === role ? "selected" : ""} ${value === "owner" ? "disabled" : ""}>${getRoleLabel(value)}</option>`
    )).join("");

    return `
      <article class="team-member" data-member-id="${id}">
        <div class="team-member__identity">
          <strong>${name}</strong>
          ${email ? `<span>${escapeHtml(email)}</span>` : ""}
        </div>
        <select class="team-member__role" data-team-role aria-label="${escapeHtml(translate("teamRoleLabel"))} ${name}" ${disabled}>${roleOptions}</select>
        <span class="team-member__status is-${status}">${translate(statusLabels[status] || "Unknown status")}</span>
        <div class="team-member__actions">
          <button class="btn btn--secondary" type="button" data-team-disable aria-label="${escapeHtml(translate("teamRemovePerson"))} ${name}" ${disabled}>${translate("teamRemovePerson")}</button>
        </div>
      </article>
    `;
  }).join("");
};

const loadTeam = async () => {
  hideLoadError();
  setLoading(true);
  if (!businessId()) {
    elements.count.textContent = "—";
    elements.list.setAttribute("aria-busy", "false");
    elements.list.replaceChildren();
    showLoadError(translate("teamBusinessUnavailable"));
    return false;
  }
  elements.count.textContent = "—";
  elements.list.setAttribute("aria-busy", "true");
  elements.list.replaceChildren();
  try {
    state.members = await loadTeamMembersRemote();
    renderTeam();
    return true;
  } catch {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.replaceChildren();
    showLoadError(translate("teamLoadError"));
    return false;
  } finally {
    setLoading(false);
  }
};

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = businessId();
  if (!id || state.loading) return;

  const payload = {
    full_name: elements.name.value.trim(),
    role: elements.role.value,
  };

  state.loading = true;
  elements.form.querySelector("button").disabled = true;
  try {
    await inviteTeamMemberRemote(payload);
    elements.form.reset();
    elements.role.value = "staff";
    showToast(translate("teamAddSuccess"));
    await loadTeam();
  } catch (error) {
    showToast(translate("teamAddError"), { type: "error" });
  } finally {
    state.loading = false;
    elements.form.querySelector("button").disabled = false;
  }
});

elements.list.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-team-role]");
  if (!select) return;
  const card = select.closest("[data-member-id]");
  const id = businessId();
  if (!card || !id) return;

  try {
    await updateTeamMemberRemote(card.dataset.memberId, { role: select.value });
    await loadTeam();
    showToast(translate("teamRoleUpdated"));
  } catch (error) {
    showToast(translate("teamRoleUpdateError"), { type: "error" });
    await loadTeam();
  }
});

elements.list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-team-disable]");
  if (!button) return;
  const card = button.closest("[data-member-id]");
  const id = businessId();
  if (!card || !id) return;
  if (!window.confirm(translate("teamConfirmRemove"))) return;

  button.disabled = true;
  try {
    await disableTeamMemberRemote(card.dataset.memberId);
    showToast(translate("teamRemoveSuccess"));
    await loadTeam();
  } catch (error) {
    showToast(translate("teamRemoveError"), { type: "error" });
    button.disabled = false;
  }
});

const start = async () => {
  hideLoadError();
  setLoading(true);
  retryButton.disabled = true;
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "team" });
      appShellReady = true;
    }
    await loadTeam();
  } catch {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.replaceChildren();
    showLoadError(translate("teamOpenError"));
  } finally {
    setLoading(false);
    retryButton.disabled = false;
  }
};

retryButton.addEventListener("click", () => void start());
void start();
