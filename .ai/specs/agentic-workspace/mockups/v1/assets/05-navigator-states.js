(() => {
  let selectedKind = "all";
  const search = document.querySelector("[data-nav-search]");
  const rows = [...document.querySelectorAll(".filter-result")];
  const empty = document.querySelector(".no-filter-results");
  const applyFilters = () => {
    const query = (search.value || "").trim().toLowerCase();
    let visible = 0;
    rows.forEach((row) => {
      const matches = row.dataset.filter.toLowerCase().includes(query) && (selectedKind === "all" || row.dataset.kind === selectedKind);
      row.hidden = !matches;
      if (matches) visible++;
    });
    empty.hidden = visible > 0;
  };
  search.addEventListener("input", applyFilters);
  document.querySelectorAll("[data-filter-kind]").forEach((button) => button.addEventListener("click", () => {
    selectedKind = button.dataset.filterKind;
    document.querySelectorAll("[data-filter-kind]").forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    });
    applyFilters();
  }));
  document.querySelectorAll("[data-project]").forEach((button) => button.addEventListener("click", () => {
    const project = button.dataset.project;
    document.querySelectorAll("[data-project]").forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("selected", selected);
      candidate.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll("[data-project-panel]").forEach((panel) => { panel.hidden = panel.dataset.projectPanel !== project; });
  }));
  document.querySelector("[data-retry]").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const card = button.closest(".state-card");
    const original = card.querySelector(".error-state");
    const loading = document.createElement("div");
    loading.className = "loading-state retry-loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Retrying local task index…";
    original.hidden = true;
    card.append(loading);
    button.disabled = true;
    window.setTimeout(() => {
      loading.remove();
      original.hidden = false;
      button.disabled = false;
      button.textContent = "Retry again";
    }, 800);
  });
})();