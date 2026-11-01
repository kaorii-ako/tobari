# Build: cmake -G Ninja -S shell -B build -DCEF_ROOT=<cef minimal distribution> -DCMAKE_BUILD_TYPE=Release
# Linux: build/out/tobari. Windows (MSVC, from a VS developer prompt): build/out/tobari.exe (CEF's bootstrap,
# loading tobari.dll inside the sandbox) and build/out/tobari-cli.exe (the console CLI and MCP server).
cmake_minimum_required(VERSION 3.21)
project(tobari C CXX)
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

file(GLOB TOBARI_SRCS src/*.cc)
set(CEF_TARGET tobari)
set(CEF_TARGET_OUT_DIR "${CMAKE_BINARY_DIR}/out")
ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_RELEASE}" "${CEF_LIB_RELEASE}")

if(OS_WINDOWS)
  # With the sandbox on, CEF ships bootstrap.exe; the app is a DLL of the same name exporting RunWinMain.
  add_library(tobari SHARED ${TOBARI_SRCS})
  SET_LIBRARY_TARGET_PROPERTIES(tobari)
  # CEF's flags turn every warning into an error; ours are fixed on Linux with -Wall, not chased per compiler.
  target_compile_options(tobari PRIVATE /WX- /EHsc)
  target_link_libraries(tobari libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS} shell32 ole32)
  set_target_properties(tobari PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CEF_TARGET_OUT_DIR}
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CEF_TARGET_OUT_DIR})
  COPY_SINGLE_FILE(tobari "${CEF_BINARY_DIR}/bootstrap.exe" "${CEF_TARGET_OUT_DIR}/tobari.exe")
  # UTF-8 as the process code page, merged into bootstrap's own manifest (win/utf8.manifest says why).
  add_custom_command(TARGET tobari POST_BUILD
    COMMAND mt.exe -nologo -inputresource:${CEF_TARGET_OUT_DIR}/tobari.exe\;\#1
            -manifest ${CMAKE_SOURCE_DIR}/win/utf8.manifest -outputresource:${CEF_TARGET_OUT_DIR}/tobari.exe\;\#1)
  SET_LPAC_ACLS(tobari)

  add_executable(tobari-cli cli_main.cc src/ctl_client.cc src/util.cc src/platform.cc)
  target_compile_options(tobari-cli PRIVATE /utf-8 /EHsc /std:c++20)
  target_link_libraries(tobari-cli ws2_32 shell32 ole32)
  set_target_properties(tobari-cli PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CEF_TARGET_OUT_DIR}
    RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CEF_TARGET_OUT_DIR})
  target_link_options(tobari-cli PRIVATE /MANIFEST:NO)
  add_custom_command(TARGET tobari-cli POST_BUILD
    COMMAND mt.exe -nologo -manifest ${CMAKE_SOURCE_DIR}/win/utf8.manifest
            -outputresource:$<TARGET_FILE:tobari-cli>\;\#1)
  set(TEST_FLAGS /UNDEBUG /utf-8 /EHsc /std:c++20)
  set(TEST_LIBS shell32 ole32 ws2_32)
else()
  add_executable(tobari ${TOBARI_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(tobari)
  target_link_libraries(tobari libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS} dl)
  set_target_properties(tobari PROPERTIES INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH TRUE
    RUNTIME_OUTPUT_DIRECTORY ${CEF_TARGET_OUT_DIR})
  # chrome-sandbox is left out on purpose: an AppImage can't keep its setuid bit, so Chromium uses the user-namespace sandbox.
  list(REMOVE_ITEM CEF_BINARY_FILES chrome-sandbox)
  set(TEST_FLAGS -UNDEBUG)
  set(TEST_LIBS dl)
endif()
add_dependencies(tobari libcef_dll_wrapper)
COPY_FILES(tobari "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
COPY_FILES(tobari "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
# Runs on every build so UI edits land without a relink.
add_custom_target(ui ALL COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/../ui" "${CEF_TARGET_OUT_DIR}/ui")

add_executable(util_test test/util_test.cc src/util.cc src/platform.cc)
target_compile_options(util_test PRIVATE ${TEST_FLAGS})
target_link_libraries(util_test ${TEST_LIBS})
add_executable(block_test test/block_test.cc src/block.cc)
target_compile_options(block_test PRIVATE ${TEST_FLAGS})
