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
  owner: "Proprietário",
  manager: "Gerente",
  staff: "Membro da equipe",
};

const getRoleLabel = (role) => translate(roleLabels[role] || roleLabels.staff);
let appShellReady = false;

const statusLabels = {
  active: "Ativo",
  inactive: "Inativo",
  pending: "Convite pendente",
};

const state = {
  members: [],
  loading: false,
};

const elements = {
  form: document.getElementById("teamInviteForm"),
  name: document.getElementById("memberName"),
  email: document.getElementById("memberEmail"),
  role: document.getElementById("memberRole"),
  list: document.getElementById("teamList"),
  count: document.getElementById("teamCount"),
};

const businessId = () => getBusiness()?.id;

const renderTeam = () => {
  elements.list.setAttribute("aria-busy", "false");
  const activeCount = state.members.filter((member) => member.status === "active").length;
  const countKey = activeCount === 1 ? "$1 pessoa ativa" : "$1 pessoas ativas";
  elements.count.textContent = translate(countKey).replace("$1", String(activeCount));

  if (!state.members.length) {
    elements.list.innerHTML = `<div class="team-empty">${translate("Nenhuma pessoa cadastrada")}</div>`;
    return;
  }

  elements.list.innerHTML = state.members.map((member) => {
    const name = escapeHtml(member.user?.name || translate("Sem nome"));
    const email = escapeHtml(member.user?.email || "");
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
          <span>${email}</span>
        </div>
        <select class="team-member__role" data-team-role aria-label="${translate("Papel de acesso de")} ${name}" ${disabled}>${roleOptions}</select>
        <span class="team-member__status is-${status}">${translate(statusLabels[status] || "Status desconhecido")}</span>
        <div class="team-member__actions">
          <button class="btn btn--secondary" type="button" data-team-disable aria-label="${translate("Remover acesso de")} ${name}" ${disabled}>${translate("Remover acesso")}</button>
        </div>
      </article>
    `;
  }).join("");
};

const loadTeam = async () => {
  if (!businessId()) {
    elements.count.textContent = "—";
    elements.list.setAttribute("aria-busy", "false");
    elements.list.innerHTML = `<p class="team-empty" role="status">${translate("Os dados do estabelecimento não estão disponíveis.")}</p>`;
    return false;
  }
  elements.count.textContent = "—";
  elements.list.setAttribute("aria-busy", "true");
  elements.list.innerHTML = `<p class="team-empty" role="status">${translate("Carregando a equipe")}</p>`;
  try {
    state.members = await loadTeamMembersRemote();
    renderTeam();
    return true;
  } catch {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.innerHTML = `<div class="team-empty" role="alert"><p>${translate("Não foi possível carregar a equipe.")}</p><button class="btn btn--secondary" type="button" data-team-retry>${translate("Tentar novamente")}</button></div>`;
    return false;
  }
};

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = businessId();
  if (!id || state.loading) return;

  const payload = {
    full_name: elements.name.value.trim(),
    email: elements.email.value.trim(),
    role: elements.role.value,
  };

  state.loading = true;
  elements.form.querySelector("button").disabled = true;
  try {
    await inviteTeamMemberRemote(payload);
    elements.form.reset();
    elements.role.value = "staff";
    showToast(translate("Pessoa adicionada à equipe"));
    await loadTeam();
  } catch (error) {
    showToast(translate("Não foi possível adicionar a pessoa"), { type: "error" });
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
    showToast(translate("Permissão atualizada"));
  } catch (error) {
    showToast(translate("Não foi possível alterar o papel"), { type: "error" });
    await loadTeam();
  }
});

elements.list.addEventListener("click", async (event) => {
  if (event.target.closest("[data-team-retry]")) {
    await start();
    return;
  }
  const button = event.target.closest("[data-team-disable]");
  if (!button) return;
  const card = button.closest("[data-member-id]");
  const id = businessId();
  if (!card || !id) return;
  if (!window.confirm(translate("Remover o acesso desta pessoa?"))) return;

  button.disabled = true;
  try {
    await disableTeamMemberRemote(card.dataset.memberId);
    showToast(translate("Acesso removido"));
    await loadTeam();
  } catch (error) {
    showToast(translate("Não foi possível remover o acesso"), { type: "error" });
    button.disabled = false;
  }
});

const start = async () => {
  try {
    if (!appShellReady) {
      await initAppShell({ activeNav: "team" });
      appShellReady = true;
    }
    await loadTeam();
  } catch {
    elements.list.setAttribute("aria-busy", "false");
    elements.list.innerHTML = `<div class="team-empty" role="alert"><p>${translate("Não foi possível abrir a equipe.")}</p><button class="btn btn--secondary" type="button" data-team-retry>${translate("Tentar novamente")}</button></div>`;
  }
};

void start();
