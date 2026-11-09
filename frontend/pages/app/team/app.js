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
  roles: [],
  editingRoleId: "",
};

const permissionAreas = [
  ["dashboard", "Painel inicial"], ["orders", "Pedidos"], ["kitchen", "Cozinha"],
  ["cashier", "Caixa"], ["delivery", "Entregas"],
  ["products", "Produtos"], ["inventory", "Estoque"], ["menu", "Cardápio"],
  ["suppliers", "Fornecedores"], ["discounts", "Descontos"],
  ["team", "Equipe"], ["reports", "Relatórios"],
  ["fiscal", "Fiscal"], ["integrations", "Integrações"], ["backups", "Backups"],
];

const storageKey = (kind) => `food-system-team-${kind}-${businessId() || "default"}`;
const readStoredArray = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
};
const readRoles = () => readStoredArray(storageKey("roles")).filter((role) =>
  role && typeof role.id === "string" && typeof role.name === "string" && Array.isArray(role.permissions)
);
const saveRoles = () => localStorage.setItem(storageKey("roles"), JSON.stringify(state.roles));
const getAssignments = () => Object.fromEntries(readStoredArray(storageKey("assignments")).filter((entry) =>
  Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string"
));
const saveAssignments = (assignments) => localStorage.setItem(storageKey("assignments"), JSON.stringify(Object.entries(assignments)));

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
const rolesModal = document.getElementById("teamRolesModal");
const roleForm = document.getElementById("teamRoleForm");
const roleName = document.getElementById("teamRoleName");
const rolePermissions = document.getElementById("teamRolePermissions");
const rolesList = document.getElementById("teamRolesList");

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
  if (event.key === "Escape" && !rolesModal.hidden) closeRolesPanel();
});

const businessId = () => getBusiness()?.id;

const renderRoleChoices = () => {
  const customOptions = state.roles.map((role) => `<option value="custom:${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`).join("");
  const standardOptions = `<option value="" disabled>Selecione um cargo</option><option value="staff">${getRoleLabel("staff")}</option><option value="manager">${getRoleLabel("manager")}</option>`;
  const selectedValue = elements.role.value;
  elements.role.innerHTML = `${standardOptions}${customOptions}`;
  elements.role.value = ["staff", "manager", ...state.roles.map((role) => `custom:${role.id}`)].includes(selectedValue) ? selectedValue : "";
};

const renderRoleManager = () => {
  rolePermissions.innerHTML = permissionAreas.map(([key, label]) => `
    <label class="team-role-permission"><input type="checkbox" name="permission" value="${key}" /><span>${label}</span></label>
  `).join("");
  rolesList.innerHTML = state.roles.length ? state.roles.map((role) => {
    const visible = permissionAreas.filter(([key]) => role.permissions.includes(key)).map(([, label]) => label);
    return `<article class="team-role-card"><div><strong>${escapeHtml(role.name)}</strong><p>${visible.length ? escapeHtml(visible.join(", ")) : "Nenhuma área selecionada"}</p></div><button class="btn btn--secondary" type="button" data-edit-role="${escapeHtml(role.id)}">Editar</button></article>`;
  }).join("") : "";
  renderRoleChoices();
};

state.roles = readRoles();
renderRoleManager();

const openRolesPanel = () => {
  rolesModal.hidden = false;
  document.body.classList.add("modal-open");
  roleName.focus();
};

function closeRolesPanel() {
  rolesModal.hidden = true;
  document.body.classList.remove("modal-open");
  resetRoleForm();
}

const resetRoleForm = () => {
  state.editingRoleId = "";
  roleForm.reset();
  document.getElementById("teamRoleSave").textContent = "Salvar cargo";
};

const startEditingRole = (id) => {
  const role = state.roles.find((item) => item.id === id);
  if (!role) return;
  state.editingRoleId = id;
  roleName.value = role.name;
  rolePermissions.querySelectorAll("input").forEach((input) => { input.checked = role.permissions.includes(input.value); });
  document.getElementById("teamRoleSave").textContent = "Atualizar cargo";
  roleName.focus();
};

document.querySelector("[data-open-roles]").addEventListener("click", openRolesPanel);
rolesModal.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-role]");
  if (edit) startEditingRole(edit.dataset.editRole);
  if (event.target.closest("[data-close-roles]")) closeRolesPanel();
});
roleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = roleName.value.trim();
  if (name.length < 2) return;
  if (state.roles.some((role) => role.id !== state.editingRoleId && role.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showToast("Já existe um cargo com esse nome", { type: "error" });
    return;
  }
  const permissions = [...rolePermissions.querySelectorAll("input:checked")].map((input) => input.value);
  const existing = state.roles.find((role) => role.id === state.editingRoleId);
  const role = { id: existing?.id || crypto.randomUUID(), name, permissions };
  state.roles = existing
    ? state.roles.map((item) => item.id === role.id ? role : item)
    : [...state.roles, role];
  saveRoles();
  renderRoleManager();
  resetRoleForm();
  showToast("Cargo salvo");
});

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
    const assignments = getAssignments();
    const customRoleId = assignments[member.id] || "";
    const customRole = state.roles.find((item) => item.id === customRoleId);
    const role = customRole ? `custom:${customRole.id}` : (member.role || "staff");
    const status = Object.hasOwn(statusLabels, member.status) ? member.status : "unknown";
    const id = escapeHtml(member.id);
    const disabled = role === "owner" ? "disabled" : "";

    const roleOptions = `${member.role === "owner" ? `<option value="owner" selected disabled>${getRoleLabel("owner")}</option>` : ""}<option value="staff" ${role === "staff" ? "selected" : ""}>${getRoleLabel("staff")}</option><option value="manager" ${role === "manager" ? "selected" : ""}>${getRoleLabel("manager")}</option>${state.roles.map((item) => `<option value="custom:${escapeHtml(item.id)}" ${role === `custom:${item.id}` ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}`;
    const permissionSummary = customRole ? `<small class="team-member__permissions">Pode ver: ${escapeHtml(permissionAreas.filter(([key]) => customRole.permissions.includes(key)).map(([, label]) => label).join(", ") || "nenhuma área selecionada" )}</small>` : "";

    return `
      <article class="team-member" data-member-id="${id}">
        <div class="team-member__identity">
          <strong>${name}</strong>
          ${email ? `<span>${escapeHtml(email)}</span>` : ""}
          ${permissionSummary}
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
    state.roles = readRoles();
    renderRoleManager();
    renderTeam();
    return true;
  } catch {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.replaceChildren();
    showLoadError(translate("loadRetryError"));
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
    role: elements.role.value.startsWith("custom:") ? "staff" : elements.role.value,
  };
  const selectedCustomRoleId = elements.role.value.startsWith("custom:") ? elements.role.value.slice(7) : "";

  state.loading = true;
  elements.form.querySelector('[type="submit"]').disabled = true;
  try {
    const result = await inviteTeamMemberRemote(payload);
    const createdMemberId = result?.member?.id;
    if (createdMemberId && selectedCustomRoleId) {
      const assignments = getAssignments();
      assignments[createdMemberId] = selectedCustomRoleId;
      saveAssignments(assignments);
    }
    elements.form.reset();
    elements.role.value = "";
    showToast(translate("teamAddSuccess"));
    await loadTeam();
  } catch (error) {
    showToast(translate("teamAddError"), { type: "error" });
  } finally {
    state.loading = false;
    elements.form.querySelector('[type="submit"]').disabled = false;
  }
});

elements.list.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-team-role]");
  if (!select) return;
  const card = select.closest("[data-member-id]");
  const id = businessId();
  if (!card || !id) return;

  try {
    const assignments = getAssignments();
    if (select.value.startsWith("custom:")) {
      assignments[card.dataset.memberId] = select.value.slice(7);
      await updateTeamMemberRemote(card.dataset.memberId, { role: "staff" });
    } else {
      delete assignments[card.dataset.memberId];
      await updateTeamMemberRemote(card.dataset.memberId, { role: select.value });
    }
    saveAssignments(assignments);
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
    const assignments = getAssignments();
    delete assignments[card.dataset.memberId];
    saveAssignments(assignments);
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
    showLoadError(translate("loadRetryError"));
  } finally {
    setLoading(false);
    retryButton.disabled = false;
  }
};

retryButton.addEventListener("click", () => void start());
void start();
