const toIsoDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromIsoDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const initCalendarPanel = ({ onSelect, onClear } = {}) => {
  const backdrop = document.createElement("button");
  backdrop.className = "calendar-id-backdrop";
  backdrop.type = "button";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Fechar calendário");

  const panel = document.createElement("aside");
  panel.className = "calendar-id-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Selecionar data do caixa");
  document.body.append(backdrop, panel);

  let selectedValue = "";
  let cursor = new Date();

  const close = () => {
    panel.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    document.body.classList.remove("calendar-id-open");
    setTimeout(() => {
      panel.hidden = true;
      backdrop.hidden = true;
    }, 180);
  };

  const render = () => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const todayValue = toIsoDate(new Date());
    const monthName = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const emptyDays = Array.from({ length: firstDay }, () => '<span class="calendar-id-panel__empty" aria-hidden="true"></span>').join("");
    const days = Array.from({ length: lastDay }, (_, index) => {
      const value = toIsoDate(new Date(year, month, index + 1));
      const classes = ["calendar-id-panel__day"];
      if (value === selectedValue) classes.push("is-selected");
      if (value === todayValue) classes.push("is-today");
      return `<button class="${classes.join(" ")}" type="button" data-calendar-date="${value}" aria-pressed="${value === selectedValue}">${index + 1}</button>`;
    }).join("");

    panel.innerHTML = `
      <div class="calendar-id-panel__handle" aria-hidden="true"></div>
      <header class="calendar-id-panel__header">
        <div><p>Filtro de caixa</p><h2>Selecionar data</h2></div>
        <button class="calendar-id-panel__close" type="button" data-calendar-close aria-label="Fechar calendário">×</button>
      </header>
      <div class="calendar-id-panel__month-nav">
        <button type="button" data-calendar-month="previous" aria-label="Mês anterior">‹</button>
        <strong>${monthName}</strong>
        <button type="button" data-calendar-month="next" aria-label="Próximo mês">›</button>
      </div>
      <div class="calendar-id-panel__weekdays" aria-hidden="true"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="calendar-id-panel__days">${emptyDays}${days}</div>
      <footer class="calendar-id-panel__actions">
        <button class="btn btn--secondary" type="button" data-calendar-today>Hoje</button>
        <button class="btn btn--secondary" type="button" data-calendar-clear ${selectedValue ? "" : "disabled"}>Limpar filtro</button>
      </footer>
    `;
  };

  const open = (value = "") => {
    selectedValue = value;
    cursor = fromIsoDate(value) || new Date();
    render();
    backdrop.hidden = false;
    panel.hidden = false;
    document.body.classList.add("calendar-id-open");
    requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      panel.classList.add("is-open");
    });
  };

  backdrop.addEventListener("click", close);
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-calendar-close]")) {
      close();
      return;
    }
    const monthButton = event.target.closest("[data-calendar-month]");
    if (monthButton) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + (monthButton.dataset.calendarMonth === "next" ? 1 : -1), 1);
      render();
      return;
    }
    const dateButton = event.target.closest("[data-calendar-date]");
    if (dateButton) {
      selectedValue = dateButton.dataset.calendarDate;
      onSelect?.(selectedValue);
      close();
      return;
    }
    if (event.target.closest("[data-calendar-today]")) {
      selectedValue = toIsoDate(new Date());
      onSelect?.(selectedValue);
      close();
      return;
    }
    if (event.target.closest("[data-calendar-clear]")) {
      selectedValue = "";
      onClear?.();
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) close();
  });

  return { open, close };
};
