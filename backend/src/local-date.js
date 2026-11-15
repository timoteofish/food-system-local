// SQLite timestamps are UTC; business days follow the computer's local time.
export const localDateString = (date = new Date()) => {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const localDayBoundaryUtc = (date, nextDay = false) => {
  const [year, month, day] = date.split("-").map(Number);
  const boundary = new Date(year, month - 1, day + (nextDay ? 1 : 0));
  return boundary.toISOString().slice(0, 19).replace("T", " ");
};
