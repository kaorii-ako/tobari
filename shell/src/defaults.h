#pragma once

namespace tobari {

// Applies Tobari's privacy and appearance defaults to the Chromium profile on
// first run only. A version marker in the data directory records which set has
// been applied, so a user's later changes in chrome://settings are never
// overwritten on the next launch.
// Returns true if any preference was written this launch.
bool ApplyFirstRunDefaults();

// Before CefInitialize, on a profile that has never been opened: writes the
// theme keys into Chromium's Preferences file so the first window is created
// in Tobari's palette. Only unprotected appearance keys are written here.
void SeedNewProfile();

}  // namespace tobari
