(() => {
  const app = document.querySelector(".context-demo");
  if (!app) return;
  const workspaceBody = app.querySelector("[data-workspace-body]");
  const terminalDrawer = app.querySelector("[data-terminal-drawer]");
  const terminalSurface = document.querySelector("[data-terminal-surface]");
  const columnSlot = app.querySelector("[data-column-slot]");
  const drawerSlot = app.querySelector("[data-drawer-slot]");
  const movedMessage = app.querySelector("[data-terminal-moved]");
  const toast = document.querySelector("[data-mockup-toast]");
  let toastTimer;

  const announce = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  };

  const setPlacement = (placement, notify = true) => {
    const inDrawer = placement === "drawer";
    if (inDrawer) {
      drawerSlot.appendChild(terminalSurface);
      terminalDrawer.hidden = false;
      workspaceBody.classList.add("terminal-drawer-mode");
    } else {
      columnSlot.appendChild(terminalSurface);
      terminalDrawer.hidden = true;
      workspaceBody.classList.remove("terminal-drawer-mode");
    }
    terminalSurface.hidden = false;
    movedMessage.hidden = !inDrawer;
    app.querySelectorAll("[data-placement]").forEach((button) => {
      const selected = button.dataset.placement === placement;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    });
    if (notify) {
      announce(inDrawer
        ? "Terminal moved to the bottom drawer. This run still has one terminal surface."
        : "Terminal moved into the Context column. This run still has one terminal surface.");
    }
  };

  terminalSurface.hidden = true;
  setPlacement("column", false);
  app.querySelectorAll("[data-placement]").forEach((button) => button.addEventListener("click", () => setPlacement(button.dataset.placement)));

  const sessionTabs = [...document.querySelectorAll("[data-terminal-sessions] [role=tab]")];
  const sessions = [...document.querySelectorAll("[data-terminal-session]")];
  sessionTabs.forEach((tab) => tab.addEventListener("click", () => {
    const panelId = tab.getAttribute("aria-controls");
    sessionTabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    sessions.forEach((panel) => { panel.hidden = panel.id !== panelId; });
  }));

  const diffButtons = [...app.querySelectorAll("[data-diff-mode]")];
  const diffPanels = [...app.querySelectorAll("[data-diff-panel]")];
  diffButtons.forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.diffMode;
    diffButtons.forEach((item) => {
      const selected = item === button;
      item.setAttribute("aria-pressed", String(selected));
      item.classList.toggle("is-selected", selected);
    });
    diffPanels.forEach((panel) => { panel.hidden = panel.dataset.diffPanel !== mode; });
  }));

  const commentButtons = [...app.querySelectorAll("[data-line-comment]")];
  const selectedComments = new Map();
  const commentList = app.querySelector("[data-comment-list]");
  const commentCount = app.querySelector("[data-comment-count]");
  const refreshComments = () => {
    commentList.replaceChildren();
    selectedComments.forEach((comment, reference) => {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = reference.split("/").slice(-1)[0];
      item.append(code, document.createTextNode(" · " + comment));
      commentList.append(item);
    });
    commentCount.textContent = selectedComments.size + (selectedComments.size === 1 ? " comment queued" : " comments queued");
  };
  commentButtons.forEach((button) => {
    if (button.getAttribute("aria-pressed") === "true") selectedComments.set(button.dataset.lineComment, button.dataset.commentText);
    button.addEventListener("click", () => {
      const reference = button.dataset.lineComment;
      const selected = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(selected));
      if (selected) selectedComments.set(reference, button.dataset.commentText);
      else selectedComments.delete(reference);
      refreshComments();
    });
  });
  refreshComments();

  app.querySelector("[data-send-comments]")?.addEventListener("click", () => {
    if (selectedComments.size === 0) {
      announce("Select a changed line before sending review comments.");
      return;
    }
    const commentText = "Review comments:\n" + [...selectedComments.entries()]
      .map(([reference, comment]) => "- " + reference + " — " + comment)
      .join("\n");
    const composer = app.querySelector("#agent-message");
    composer.value = composer.value.trim()
      ? composer.value.replace(/\s+$/, "") + "\n\n" + commentText
      : commentText;
    composer.focus();
    composer.setSelectionRange(composer.value.length, composer.value.length);
    announce("Review comments added to the Improve retry cleanup composer.");
  });

  app.querySelectorAll(".file-preview-tree [data-file-name]").forEach((button) => button.addEventListener("click", () => {
    app.querySelectorAll(".file-preview-tree .file-row").forEach((row) => row.classList.toggle("is-selected", row === button));
    const title = app.querySelector("[data-preview-file]");
    if (title) title.textContent = button.dataset.fileName;
  }));

  app.querySelectorAll("[data-review-action]").forEach((button) => button.addEventListener("click", () => {
    announce(button.dataset.reviewAction === "pr"
      ? "Create PR is an explicit action. The review does not auto-merge."
      : "Finish is an explicit action for Improve retry cleanup.");
  }));
  app.querySelectorAll("[data-inspector-action]").forEach((button) => button.addEventListener("click", () => {
    announce(button.dataset.inspectorAction === "pause" ? "Pause run is an explicit user action." : "Run logs opened for this local task.");
  }));
  app.querySelector("[data-message-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    announce("Message is ready for Improve retry cleanup.");
  });
  app.querySelector("[data-reload-preview]")?.addEventListener("click", () => announce("Local preview refreshed."));
  app.querySelectorAll("[data-open-child]").forEach((button) => button.addEventListener("click", () => announce(button.dataset.openChild + " is a separate child run with its own branch.")));
})();
