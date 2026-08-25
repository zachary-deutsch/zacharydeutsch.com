"use strict";

const API_URL = "https://baptist-health-voice-poc-8063.twil.io/contact-portal";
const STORAGE_KEY = "voice-demo-simulation-v1";
const ACCESS_STORAGE_KEY = "voice-demo-access";
let accessKey = readAccessKey();

let state = emptyState();
let pendingLaunch = null;

const byId = (id) => document.getElementById(id);
const notice = byId("notice");

function readAccessKey() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const key = fragment.get("access");
  if (key) {
    window.sessionStorage.setItem(ACCESS_STORAGE_KEY, key);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return key;
  }
  return window.sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
}

function emptyState() {
  return {
    mode: "simulation",
    live_test_configured: false,
    max_batch_size: 3,
    contacts: [],
    batches: [],
  };
}

function uid(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function showMessage(text, isError = false) {
  notice.textContent = text;
  notice.className = isError ? "notice error" : "notice";
}

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Portal-Access": accessKey,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* Return the generic error below. */ }
  if (!response.ok) throw new Error(body.error || "The portal request was rejected.");
  return body;
}

function loadSimulation() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (parsed && Array.isArray(parsed.contacts) && Array.isArray(parsed.batches)) {
      return { ...emptyState(), ...parsed, mode: "simulation", live_test_configured: false };
    }
  } catch (_) { /* Start with an empty simulation workspace. */ }
  return emptyState();
}

function saveSimulation() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ contacts: state.contacts, batches: state.batches }));
}

function maskNumber(number) {
  const digits = String(number).replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "Masked";
}

function formatCreated(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Just now" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusPill(value) {
  const node = document.createElement("span");
  node.className = `status-pill ${String(value).toLowerCase().replace(/[^a-z]+/g, "-")}`;
  node.textContent = String(value).replaceAll("_", " ");
  return node;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function updateSelection() {
  const selected = [...document.querySelectorAll(".contact-select:checked")];
  const names = selected.map((input) => input.dataset.name);
  byId("selected-count").textContent = `${selected.length} selected`;
  byId("selected-names").textContent = names.length ? names.join(", ") : "Choose contacts in the roster below.";
  byId("create-batch").disabled = selected.length === 0 || selected.length > state.max_batch_size;
}

function renderContacts() {
  const tbody = byId("contacts");
  tbody.replaceChildren();
  const activeContacts = state.contacts.filter((contact) => contact.active !== false);
  byId("contacts-empty").classList.toggle("visible", state.contacts.length === 0);

  for (const contact of state.contacts) {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    const selector = document.createElement("input");
    selector.type = "checkbox";
    selector.className = "contact-select";
    selector.value = contact.contact_id;
    selector.dataset.name = contact.display_name;
    selector.disabled = contact.active === false || contact.synthetic_authorized !== true;
    selector.setAttribute("aria-label", `Select ${contact.display_name}`);
    selector.addEventListener("change", updateSelection);
    selectCell.append(selector);
    row.append(selectCell);

    for (const value of [
      contact.display_name,
      contact.phone_masked || maskNumber(contact.phone_e164),
      contact.synthetic_authorized ? "Test authorized" : "Not authorized",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const statusCell = document.createElement("td");
    statusCell.append(statusPill(contact.active === false ? "archived" : "active"));
    row.append(statusCell);

    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(actionButton("Edit", "quiet", () => editContact(contact)));
    if (contact.active !== false) actions.append(actionButton("Archive", "link-danger", () => archiveContact(contact.contact_id)));
    actionCell.append(actions);
    row.append(actionCell);
    tbody.append(row);
  }
  byId("contact-count").textContent = String(activeContacts.length);
  updateSelection();
}

function renderBatches() {
  const tbody = byId("batches");
  tbody.replaceChildren();
  byId("batches-empty").classList.toggle("visible", state.batches.length === 0);
  let ready = 0;
  let completed = 0;

  for (const batch of state.batches) {
    if (batch.status === "ready") ready += 1;
    completed += batch.items.filter((item) => ["simulated", "completed"].includes(item.status)).length;
    const row = document.createElement("tr");
    const created = document.createElement("td");
    created.textContent = formatCreated(batch.created_at_utc);
    row.append(created);
    const status = document.createElement("td");
    status.append(statusPill(batch.status));
    row.append(status);
    const itemCell = document.createElement("td");
    const items = document.createElement("div");
    items.className = "batch-items";
    for (const item of batch.items) {
      const line = document.createElement("span");
      line.textContent = `${item.display_name_snapshot} · ${item.phone_masked || maskNumber(item.phone_e164_snapshot)} · ${item.status}`;
      items.append(line);
    }
    itemCell.append(items);
    row.append(itemCell);
    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (batch.status === "ready") actions.append(actionButton("Simulate", "quiet", () => simulateBatch(batch.batch_id)));
    if (state.live_test_configured && ["ready", "running"].includes(batch.status)) {
      actions.append(actionButton("Launch calls", "primary", () => openLaunchDialog(batch)));
    }
    if (["ready", "running", "blocked"].includes(batch.status)) actions.append(actionButton("Cancel", "link-danger", () => cancelBatch(batch.batch_id)));
    actionCell.append(actions);
    row.append(actionCell);
    tbody.append(row);
  }
  byId("ready-count").textContent = String(ready);
  byId("completed-count").textContent = String(completed);
}

function render() {
  const connected = state.mode === "connected";
  byId("connection-dot").classList.toggle("connected", connected);
  byId("connection-label").textContent = connected ? "Operator controls connected" : "Simulation workspace";
  byId("connection-detail").textContent = connected
    ? (state.live_test_configured ? "Approved test calling is enabled." : "Calling remains disabled by the server.")
    : "No calls can be placed from this browser.";
  byId("operator-access").hidden = connected;
  byId("operator-disconnect").hidden = !connected;
  renderContacts();
  renderBatches();
}

function editContact(contact) {
  byId("editing-id").value = contact.contact_id;
  byId("display-name").value = contact.display_name;
  byId("phone-e164").value = contact.phone_e164 || "";
  byId("phone-e164").placeholder = contact.phone_masked ? "Enter the complete number to change it" : "+13125550123";
  byId("phone-e164").required = !contact.phone_masked;
  byId("synthetic-authorized").checked = contact.synthetic_authorized === true;
  byId("save-contact").textContent = "Save contact";
  byId("display-name").focus();
}

function clearContactForm() {
  byId("contact-form").reset();
  byId("editing-id").value = "";
  byId("phone-e164").placeholder = "+13125550123";
  byId("phone-e164").required = true;
  byId("save-contact").textContent = "Add contact";
}

async function refresh() {
  if (!accessKey) {
    state = loadSimulation();
    render();
    return false;
  }
  try {
    const result = await api("state");
    state = { ...result, mode: "connected" };
    render();
    return true;
  } catch (_) {
    state = loadSimulation();
    render();
    showMessage("Operator connection is unavailable. The page is safely running in simulation mode.", true);
    return false;
  }
}

byId("operator-access").addEventListener("click", () => {
  byId("access-input").value = "";
  byId("access-error").textContent = "";
  byId("access-dialog").showModal();
  byId("access-input").focus();
});

byId("cancel-access").addEventListener("click", () => byId("access-dialog").close());

byId("access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const candidate = byId("access-input").value.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(candidate)) {
    byId("access-error").textContent = "Enter the complete demo access code.";
    return;
  }
  const connectButton = byId("confirm-access");
  connectButton.disabled = true;
  byId("access-error").textContent = "";
  accessKey = candidate;
  try {
    const connected = await refresh();
    if (!connected) throw new Error("access_rejected");
    window.sessionStorage.setItem(ACCESS_STORAGE_KEY, accessKey);
    byId("access-dialog").close();
    showMessage("Operator controls enabled for this browser session.");
  } catch (_) {
    accessKey = "";
    window.sessionStorage.removeItem(ACCESS_STORAGE_KEY);
    byId("access-error").textContent = "That access code was not accepted.";
  } finally {
    connectButton.disabled = false;
  }
});

byId("operator-disconnect").addEventListener("click", () => {
  accessKey = "";
  window.sessionStorage.removeItem(ACCESS_STORAGE_KEY);
  state = loadSimulation();
  render();
  showMessage("Operator controls disconnected. This browser is back in simulation mode.");
});

byId("contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const contactId = byId("editing-id").value;
  const payload = {
    contact_id: contactId || undefined,
    display_name: byId("display-name").value.trim(),
    phone_e164: byId("phone-e164").value.trim(),
    synthetic_authorized: byId("synthetic-authorized").checked,
  };
  try {
    if (state.mode === "connected") {
      const result = await api(contactId ? "update_contact" : "create_contact", payload);
      state = { ...result, mode: "connected" };
    } else if (contactId) {
      const contact = state.contacts.find((item) => item.contact_id === contactId);
      Object.assign(contact, payload);
      for (const batch of state.batches.filter((item) => item.status === "ready")) batch.status = "blocked";
      saveSimulation();
    } else {
      state.contacts.unshift({ ...payload, contact_id: uid("ctc"), active: true, created_at_utc: new Date().toISOString() });
      saveSimulation();
    }
    clearContactForm();
    render();
    showMessage(contactId ? "Contact updated. Pending batches were blocked for review." : "Synthetic contact added.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

byId("clear-contact").addEventListener("click", clearContactForm);

async function archiveContact(contactId) {
  if (!window.confirm("Archive this synthetic contact?")) return;
  try {
    if (state.mode === "connected") {
      const result = await api("archive_contact", { contact_id: contactId });
      state = { ...result, mode: "connected" };
    } else {
      const contact = state.contacts.find((item) => item.contact_id === contactId);
      if (contact) contact.active = false;
      saveSimulation();
    }
    render();
    showMessage("Contact archived.");
  } catch (error) { showMessage(error.message, true); }
}

byId("create-batch").addEventListener("click", async () => {
  const contactIds = [...document.querySelectorAll(".contact-select:checked")].map((input) => input.value);
  if (!contactIds.length || contactIds.length > state.max_batch_size) {
    showMessage(`Select between 1 and ${state.max_batch_size} contacts.`, true);
    return;
  }
  try {
    if (state.mode === "connected") {
      const result = await api("create_batch", { contact_ids: contactIds });
      state = { ...result, mode: "connected" };
    } else {
      const items = contactIds.map((contactId) => {
        const contact = state.contacts.find((candidate) => candidate.contact_id === contactId);
        return {
          batch_item_id: uid("bti"),
          contact_id: contactId,
          display_name_snapshot: contact.display_name,
          phone_e164_snapshot: contact.phone_e164,
          status: "planned",
        };
      });
      state.batches.unshift({ batch_id: uid("bat"), created_at_utc: new Date().toISOString(), status: "ready", items });
      saveSimulation();
    }
    render();
    showMessage("Review batch frozen. You can now simulate the workflow.");
  } catch (error) { showMessage(error.message, true); }
});

async function simulateBatch(batchId) {
  try {
    if (state.mode === "connected") {
      const result = await api("simulate_batch", { batch_id: batchId });
      state = { ...result, mode: "connected" };
    } else {
      const batch = state.batches.find((item) => item.batch_id === batchId);
      if (batch) {
        batch.status = "simulated";
        batch.items.forEach((item) => { item.status = "simulated"; });
      }
      saveSimulation();
    }
    render();
    showMessage("Simulation complete. No calls were placed.");
  } catch (error) { showMessage(error.message, true); }
}

async function cancelBatch(batchId) {
  try {
    if (state.mode === "connected") {
      const result = await api("cancel_batch", { batch_id: batchId });
      state = { ...result, mode: "connected" };
    } else {
      const batch = state.batches.find((item) => item.batch_id === batchId);
      if (batch) {
        batch.status = "cancelled";
        batch.items.filter((item) => item.status === "planned").forEach((item) => { item.status = "cancelled"; });
      }
      saveSimulation();
    }
    render();
    showMessage("Remaining batch items cancelled.");
  } catch (error) { showMessage(error.message, true); }
}

function openLaunchDialog(batch) {
  pendingLaunch = batch;
  byId("confirmation-phrase").textContent = batch.batch_confirmation;
  byId("confirmation-input").value = "";
  byId("confirm-dialog").showModal();
}

byId("confirm-dialog").addEventListener("close", async () => {
  if (byId("confirm-dialog").returnValue !== "default" || !pendingLaunch) {
    pendingLaunch = null;
    return;
  }
  const confirmation = byId("confirmation-input").value;
  const batchId = pendingLaunch.batch_id;
  pendingLaunch = null;
  try {
    const result = await api("launch_batch", { batch_id: batchId, confirmation });
    state = { ...result, mode: "connected" };
    render();
    showMessage("The guarded test batch was submitted. Calls will not be retried automatically.");
  } catch (error) { showMessage(error.message, true); }
});

refresh();
window.setInterval(() => {
  if (accessKey) refresh();
}, 7000);
