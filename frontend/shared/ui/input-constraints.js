const BRAZIL_PHONE_PATTERN = String.raw`\([0-9]{2}\) [0-9]{4,5}-[0-9]{4}`;

const phoneDigits = (value) => {
  let digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) digits = digits.slice(2);
  return digits.slice(0, 11);
};

const formatBrazilPhone = (value) => {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;

  const areaCode = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  if (digits.length <= 6) return `(${areaCode}) ${subscriber}`;

  const splitAt = digits.length === 11 ? 5 : 4;
  const firstPart = subscriber.slice(0, splitAt);
  const secondPart = subscriber.slice(splitAt);
  return `(${areaCode}) ${firstPart}${secondPart ? `-${secondPart}` : ""}`;
};

const caretAfterDigits = (value, count) => {
  if (count <= 0) return value.startsWith("(") ? 1 : 0;
  let digitsSeen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) digitsSeen += 1;
    if (digitsSeen >= count) return index + 1;
  }
  return value.length;
};

const configurePhoneInput = (input) => {
  input.inputMode = "numeric";
  // Allow common pasted formats such as +55 (11) 91234-5678 before normalization.
  input.maxLength = 40;
  input.pattern = BRAZIL_PHONE_PATTERN;
  input.title = "Informe DDD e telefone com 10 ou 11 dígitos.";
};

const formatPhoneInput = (input) => {
  if (!(input instanceof HTMLInputElement) || input.type !== "tel" || input.readOnly || input.disabled) return;
  configurePhoneInput(input);

  const rawValue = input.value;
  const caret = input.selectionStart ?? rawValue.length;
  const digitsBeforeCaret = rawValue.slice(0, caret).replace(/\D/g, "").length;
  const formatted = formatBrazilPhone(rawValue);
  if (input.value !== formatted) input.value = formatted;

  const digits = phoneDigits(formatted);
  const complete = digits.length === 10 || digits.length === 11;
  input.setCustomValidity(!digits.length || complete ? "" : "Informe DDD e telefone com 10 ou 11 dígitos.");

  if (document.activeElement === input && typeof input.setSelectionRange === "function") {
    const position = caretAfterDigits(formatted, Math.min(digitsBeforeCaret, digits.length));
    input.setSelectionRange(position, position);
  }
};

document.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === "tel") formatPhoneInput(event.target);
});

const initializePhoneInputs = (root = document) => {
  if (root instanceof HTMLInputElement && root.type === "tel") formatPhoneInput(root);
  root.querySelectorAll?.('input[type="tel"]').forEach(formatPhoneInput);
};

initializePhoneInputs();
new MutationObserver((records) => {
  records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node instanceof Element) initializePhoneInputs(node);
  }));
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.type === "tel") {
    formatPhoneInput(event.target);
    return;
  }
  if (event.target.dataset.inputFormat === "identifier") {
    const input = event.target;
    const start = input.selectionStart ?? input.value.length;
    const beforeCaret = input.value.slice(0, start).replace(/[^A-Za-z0-9_-]/g, "").length;
    const normalized = input.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
    input.value = normalized;
    input.setCustomValidity("");
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(Math.min(beforeCaret, normalized.length), Math.min(beforeCaret, normalized.length));
  }
});

document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === "tel") formatPhoneInput(event.target);
});
