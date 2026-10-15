import {
  disableTeamMemberRemote,
  inviteTeamMemberRemote,
  loadTeamMembersRemote,
  updateTeamMemberRemote,
} from "../../../shared/auth/auth.js";
import { getBusiness } from "../../../shared/data/storage.js";
import { initAppShell, showToast } from "../../../shared/ui/ui.js";
import { escapeHtml } from "../../../shared/utils/utils.js";

const roleLabels = {
  owner: "Dono",
  manager: "Gerente",
  cashier: "Caixa",
  kitchen: "Cozinha",
  viewer: "Leitura",
};

const statusLabels = {
  active: "Ativo",
  inactive: "Inativo",
  invited: "Convidado",
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
  const activeCount = state.members.filter((member) => member.status === "active").length;
  elements.count.textContent = `${activeCount} ${activeCount === 1 ? "membro ativo" : "membros ativos"}`;

  if (!state.members.length) {
    elements.list.innerHTML = `<div class="team-empty">Nenhuma pessoa cadastrada.</div>`;
    return;
  }

  elements.list.innerHTML = state.members.map((member) => {
    const name = escapeHtml(member.user?.name || "Sem nome");
    const email = escapeHtml(member.user?.email || "");
    const role = escapeHtml(member.role || "viewer");
    const status = escapeHtml(member.status || "inactive");
    const id = escapeHtml(member.id);
    const disabled = role === "owner" ? "disabled" : "";

    const roleOptions = Object.entries(roleLabels).map(([value, label]) => (
      `<option value="${value}" ${value === role ? "selected" : ""} ${value === "owner" ? "disabled" : ""}>${label}</option>`
    )).join("");

    return `
      <article class="team-member" data-member-id="${id}">
        <div class="team-member__identity">
          <strong>${name}</strong>
          <span>${email}</span>
        </div>
        <select class="team-member__role" data-team-role ${disabled}>${roleOptions}</select>
        <span class="team-member__status is-${status}">${statusLabels[status] || status}</span>
        <div class="team-member__actions">
          <button class="btn btn--secondary" type="button" data-team-disable ${disabled}>Desativar</button>
        </div>
      </article>
    `;
  }).join("");
};

const loadTeam = async () => {
  if (!businessId()) return;
  state.members = await loadTeamMembersRemote();
  renderTeam();
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
    elements.role.value = "manager";
    await loadTeam();
    showToast("Pessoa adicionada com acesso seguro.");
  } catch (error) {
    showToast(error?.message || "Nao foi possivel adicionar a pessoa.", { type: "error" });
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
    showToast("Papel atualizado.");
  } catch (error) {
    showToast(error?.message || "Nao foi possivel alterar o papel.", { type: "error" });
    await loadTeam();
  }
});

elements.list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-team-disable]");
  if (!button) return;
  const card = button.closest("[data-member-id]");
  const id = businessId();
  if (!card || !id) return;

  button.disabled = true;
  try {
    await disableTeamMemberRemote(card.dataset.memberId);
    await loadTeam();
    showToast("Acesso desativado.");
  } catch (error) {
    showToast(error?.message || "Nao foi possivel desativar o acesso.", { type: "error" });
    button.disabled = false;
  }
});

(async () => {
  await initAppShell({ activeNav: "team" });
  await loadTeam();
})();
