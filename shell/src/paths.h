#pragma once

#include <string>

namespace tobari {

std::string ExecutableDir();
std::string ExecutablePath();
// Where the bundled extensions and filter lists live: next to the binary on
// Linux, Contents/Resources inside the app bundle on macOS.
std::string ResourcesDir();
std::string DataDir();
std::string ProfileDir();
std::string FiltersDir();
std::string DownloadsDir();
void EnsureDir(const std::string& path);
bool Readable(const std::string& path);
bool ReadFile(const std::string& path, std::string* out);
bool WriteFileAtomic(const std::string& path, const std::string& data);

}  // namespace tobari
