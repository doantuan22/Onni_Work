(() => {
  document.querySelectorAll("[data-context-tab]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.contextTab;
    document.querySelectorAll("[data-context-tab]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === button)));
    document.querySelectorAll(".phone-context-view").forEach((view) => { view.hidden = view.id !== id; });
  }));
  document.querySelectorAll("[data-context-close]").forEach((button) => button.addEventListener("click", () => {
    const frame = button.closest(".phone-frame");
    frame.querySelector(".phone-context-tabs").hidden = true;
    frame.querySelectorAll(".phone-context-view").forEach((view) => { view.hidden = true; });
    frame.querySelector(".phone-title-stack strong").textContent = "Reduce flaky test retries";
    frame.querySelector(".phone-title-stack small").textContent = "Conversation · Codex";
    const returned = document.createElement("div");
    returned.className = "phone-return-view";
    returned.textContent = "Back to the active conversation";
    frame.append(returned);
  }));
  document.querySelectorAll("[data-drawer-toggle]").forEach((button) => button.addEventListener("click", () => {
    const frame = button.closest(".phone-frame");
    const drawer = frame.querySelector(".phone-drawer-body");
    if (drawer) {
      drawer.hidden = !drawer.hidden;
      button.setAttribute("aria-label", drawer.hidden ? "Open navigator drawer" : "Close navigator drawer");
    } else {
      const toast = document.querySelector("[data-mobile-toast]");
      toast.textContent = "Navigator drawer · project tabs and task groups";
      toast.hidden = false;
      window.setTimeout(() => { toast.hidden = true; }, 2400);
    }
  }));
  document.querySelectorAll("[data-context-open]").forEach((button) => button.addEventListener("click", () => {
    const toast = document.querySelector("[data-mobile-toast]");
    toast.textContent = "Context opens as a full-screen sheet for the active conversation.";
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 2400);
  }));
  document.querySelectorAll("[data-schedule-mobile]").forEach((button) => button.addEventListener("click", () => {
    const toast = document.querySelector("[data-mobile-toast]");
    toast.textContent = "Scheduled for tomorrow at 09:00 · no run started";
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 3000);
  }));
  document.querySelectorAll("[data-start-mobile]").forEach((button) => button.addEventListener("click", () => {
    const toast = document.querySelector("[data-mobile-toast]");
    toast.textContent = "Task started · this draft becomes /tasks/e5c8a120";
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 3000);
  }));
  document.querySelectorAll(".ask-choice").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".ask-choice").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  }));
})();