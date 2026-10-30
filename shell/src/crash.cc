#include "crash.h"

#include <chrono>
#include <fstream>
#include <system_error>

#include "paths.h"

namespace fs = std::filesystem;

namespace tobari {

int HarvestCrashReports() {
  std::error_code ec;
  const fs::path out = CrashDir();
  const fs::path dumps = out / "dumps";
  int moved = 0;
  for (const char* sub : {"Crashpad/completed", "Crash Reports/completed"}) {
    const fs::path src = ProfileDir() / sub;
    if (!fs::is_directory(src, ec)) continue;
    for (const auto& e : fs::directory_iterator(src, ec)) {
      if (e.path().extension() != ".dmp") continue;
      fs::create_directories(dumps, ec);
      const fs::path dst = dumps / e.path().filename();
      fs::rename(e.path(), dst, ec);
      if (ec) {
        fs::copy_file(e.path(), dst, fs::copy_options::overwrite_existing, ec);
        fs::remove(e.path(), ec);
      }
      const auto when = fs::last_write_time(dst, ec);
      const auto secs = std::chrono::duration_cast<std::chrono::seconds>(
                            when.time_since_epoch() - fs::file_time_type::clock::now().time_since_epoch() +
                            std::chrono::system_clock::now().time_since_epoch())
                            .count();
      std::ofstream txt(out / (e.path().stem().string() + ".txt"));
      txt << "Tobari crash report\n"
          << "product: Tobari 0.5.0\n"
          << "crashed at (unix): " << secs << "\n"
          << "minidump: " << dst.string() << " (" << fs::file_size(dst, ec) << " bytes, kept on this computer)\n"
          << "\nThe minidump holds memory from the crashed process and can contain page content. "
             "It is never sent automatically. Attach it to a bug report only if you are comfortable with that.\n";
      ++moved;
    }
  }
  return moved;
}

}
