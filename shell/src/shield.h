#pragma once

namespace tobari {

// Serves https://tobari.internal/* to the bundled Tobari toolbar extension and
// to nothing else. A request is answered only when it comes from a frame whose
// URL is inside that extension; every other caller gets 403.
void RegisterShieldBridge();

}  // namespace tobari
