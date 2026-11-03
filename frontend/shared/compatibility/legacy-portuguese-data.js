// Legacy Portuguese values are read only to preserve existing orders and printed QR codes.
export const legacyMenuQueryParams = Object.freeze({
  table: "mesa",
  business: "negocio",
  tableToken: "mesa_token",
});

export const legacyOrderNoteLabels = Object.freeze({
  table: "Mesa",
  payment: "Pagamento",
});

export const legacyPaymentMethodEntries = Object.freeze([
  ["balcao", "counter"],
  ["dinheiro_balcao", "cash_at_counter"],
  ["dinheiro no balcao", "cash_at_counter"],
  ["credito", "credit_card"],
  ["cartao de credito", "credit_card"],
  ["debito", "debit_card"],
  ["cartao de debito", "debit_card"],
]);
