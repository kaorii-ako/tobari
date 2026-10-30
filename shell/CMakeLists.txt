cmake_minimum_required(VERSION 3.21)
project(tobari_shell CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(cmake/FetchCEF.cmake)
list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

add_executable(tobari-shell src/main.cc src/app.cc src/client.cc src/crash.cc)
SET_EXECUTABLE_TARGET_PROPERTIES(tobari-shell)
add_dependencies(tobari-shell libcef_dll_wrapper)
target_link_libraries(tobari-shell libcef_dll_wrapper ${CEF_STANDARD_LIBS} "${CEF_BINARY_DIR}/libcef.so")
target_include_directories(tobari-shell PRIVATE "${CEF_ROOT}")
set_target_properties(tobari-shell PROPERTIES BUILD_RPATH "\$ORIGIN" INSTALL_RPATH "\$ORIGIN")

set(OUT "$<TARGET_FILE_DIR:tobari-shell>")
COPY_FILES(tobari-shell "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${OUT}")
COPY_FILES(tobari-shell "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${OUT}")
add_custom_command(TARGET tobari-shell POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_SOURCE_DIR}/../extension/dist" "${OUT}/extension"
  COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_SOURCE_DIR}/crash_reporter.cfg" "${OUT}/crash_reporter.cfg")
