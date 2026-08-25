"use strict";

const API_URL = "https://baptist-health-voice-poc-8063.twil.io/contact-portal";

let state = { contacts: [], batches: [], max_batch_size: 3, live_test_configured: false };
let busy = false;

const byId = (id) => document.getElementById(id);

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  let body = {};
  try { body = await response.json(); } catch (_) { /* Use the generic message below. */ }
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function activeContacts() {
  return state.contacts.filter((contact) => contact.active === true);
}

function setNotice(message, isError = false) {
  const notice = byId("notice");
  notice.textContent = message;
  notice.className = isError ? "notice error" : "notice";
}

function setBusy(value) {
  busy = value;
  renderCallButton();
}

function renderCallButton() {
  const contacts = activeContacts();
  const button = byId("call-list");
  const count = contacts.length;
  button.textContent = count === 0 ? "Call listed contacts" : count === 1 ? `Call ${contacts[0].display_name}` : `Call ${count} people`;
  button.disabled = busy || count === 0 || count > state.max_batch_size || !state.live_test_configured;
  byId("add-contact").disabled = busy || count >= state.max_batch_size;
}

function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (String(value).trim().startsWith("+") && digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return String(value).trim();
}

function renderContacts() {
  const list = byId("contact-list");
  const contacts = activeContacts();
  list.replaceChildren();
  byId("empty-list").hidden = contacts.length !== 0;

  for (const contact of contacts) {
    const item = document.createElement("li");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const phone = document.createElement("span");
    const remove = document.createElement("button");

    name.textContent = contact.display_name;
    phone.textContent = contact.phone_masked;
    details.append(name, phone);

    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${contact.display_name}`);
    remove.addEventListener("click", () => removeContact(contact.contact_id));

    item.append(details, remove);
    list.append(item);
  }
  renderCallButton();
}

async function refresh() {
  try {
    state = await api("state");
    renderContacts();
  } catch (_) {
    setNotice("The call list is temporarily unavailable.", true);
    byId("call-list").disabled = true;
  }
}

byId("contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = byId("name").value.trim();
  const phone = normalizePhone(byId("phone").value);
  if (!name || !phone) return;

  setBusy(true);
  setNotice("");
  try {
    state = await api("create_contact", {
      display_name: name,
      phone_e164: phone,
      synthetic_authorized: true,
    });
    event.currentTarget.reset();
    renderContacts();
  } catch (error) {
    setNotice(error.message === "duplicate_contact" ? "That phone number is already listed." : "Check the name and phone number, then try again.", true);
  } finally {
    setBusy(false);
  }
});

async function removeContact(contactId) {
  setBusy(true);
  setNotice("");
  try {
    state = await api("archive_contact", { contact_id: contactId });
    renderContacts();
  } catch (_) {
    setNotice("That person could not be removed.", true);
  } finally {
    setBusy(false);
  }
}

byId("call-list").addEventListener("click", async () => {
  const contacts = activeContacts();
  if (contacts.length === 0 || contacts.length > state.max_batch_size) return;

  setBusy(true);
  setNotice("Starting calls…");
  let batchId = null;
  try {
    const existingBatchIds = new Set(state.batches.map((batch) => batch.batch_id));
    state = await api("create_batch", { contact_ids: contacts.map((contact) => contact.contact_id) });
    const batch = state.batches.find((candidate) => !existingBatchIds.has(candidate.batch_id) && candidate.status === "ready");
    if (!batch) throw new Error("batch_not_created");
    batchId = batch.batch_id;
    state = await api("launch_batch", {
      batch_id: batch.batch_id,
      confirmation: batch.batch_confirmation,
    });
    renderContacts();
    setNotice(contacts.length === 1 ? `Calling ${contacts[0].display_name}.` : `Calling ${contacts.length} people.`);
  } catch (error) {
    if (batchId) {
      try { state = await api("cancel_batch", { batch_id: batchId }); } catch (_) { /* Do not retry a call request. */ }
    }
    const messages = {
      destination_not_allowed: "One or more numbers are not approved for this demo.",
      daily_limit_reached: "The demo call limit has been reached for today.",
      destination_suppressed: "One or more numbers have opted out of calls.",
      live_calling_disabled: "Calling is currently unavailable.",
    };
    setNotice(messages[error.message] || "The calls could not be started.", true);
  } finally {
    setBusy(false);
  }
});

refresh();
