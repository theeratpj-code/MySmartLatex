// Fill in the three PASTE_ values (see setup-guide.html). None of these are secrets:
// without Google permission to read your Drive files, they cannot be used for anything.
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com",
  LOGIN_HINT: "theerat.pp@gmail.com",
  IDLE_MINUTES: 15, // automatic sign-out after this many idle minutes
  FILES: [
    { label: "2025", id: "PASTE_DRIVE_FILE_ID_FOR_2025" },
    { label: "2026", id: "PASTE_DRIVE_FILE_ID_FOR_2026" },
  ],
};
