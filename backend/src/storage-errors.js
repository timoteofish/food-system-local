const STORAGE_FULL_MARKER = "FOOD_SYSTEM_STORAGE_FULL";

export const isStorageFull = (error) => {
  for (let current = error; current; current = current.cause) {
    if (["ENOSPC", "EDQUOT", "SQLITE_FULL"].includes(current.code)) return true;
    if (Number.isInteger(current.errcode) && (current.errcode & 255) === 13) return true;
    if (typeof current.stderr === "string" && current.stderr.split(/\r?\n/).includes(STORAGE_FULL_MARKER)) return true;
  }
  return false;
};

export const STORAGE_FULL_SIGNAL = STORAGE_FULL_MARKER;
export const isInvalidBackup = (error) => typeof error?.stderr === "string" && error.stderr.split(/\r?\n/).includes("FOOD_SYSTEM_BACKUP_INVALID");
