# Build: cmake -G Ninja -S shell -B build -DCEF_ROOT=<cef minimal distribution> -DCMAKE_BUILD_TYPE=Release
cmake_minimum_required(VERSION 3.21)
project(tobari C CXX)
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

file(GLOB TOBARI_SRCS src/*.cc)
set(CEF_TARGET tobari)
set(CEF_TARGET_OUT_DIR "${CMAKE_BINARY_DIR}/out")
ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_RELEASE}" "${CEF_LIB_RELEASE}")
add_executable(tobari ${TOBARI_SRCS})
SET_EXECUTABLE_TARGET_PROPERTIES(tobari)
add_dependencies(tobari libcef_dll_wrapper)
target_link_libraries(tobari libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS} dl)
set_target_properties(tobari PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH TRUE
  RUNTIME_OUTPUT_DIRECTORY ${CEF_TARGET_OUT_DIR})
# chrome-sandbox is left out on purpose: an AppImage can't keep its setuid bit, so Chromium uses the user-namespace sandbox.
list(REMOVE_ITEM CEF_BINARY_FILES chrome-sandbox)
COPY_FILES(tobari "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
COPY_FILES(tobari "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
# Runs on every build so UI edits land without a relink.
add_custom_target(ui ALL COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/../ui" "${CEF_TARGET_OUT_DIR}/ui")

add_executable(util_test test/util_test.cc src/util.cc)
target_compile_options(util_test PRIVATE -UNDEBUG)
add_executable(block_test test/block_test.cc src/block.cc)
target_compile_options(block_test PRIVATE -UNDEBUG)
