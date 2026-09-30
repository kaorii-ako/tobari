cmake_minimum_required(VERSION 3.21)
project(tobari C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED CEF_ROOT)
  if(DEFINED ENV{CEF_ROOT})
    set(CEF_ROOT "$ENV{CEF_ROOT}")
  else()
    message(FATAL_ERROR "CEF_ROOT is not set. Run shell/provision-cef.sh, then export CEF_ROOT.")
  endif()
endif()

set(CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)

ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")

add_subdirectory("${CEF_ROOT}/libcef_dll" libcef_dll_wrapper)

set(CEF_TARGET_OUT_DIR "${CMAKE_CURRENT_BINARY_DIR}")

set(TOBARI_SRCS
  src/main.cc
  src/app.cc
  src/scheme.cc
  src/window.cc
)

add_executable(tobari ${TOBARI_SRCS})
target_include_directories(tobari PRIVATE "${CEF_ROOT}" "${CMAKE_CURRENT_SOURCE_DIR}/src")
add_dependencies(tobari libcef_dll_wrapper)
target_link_libraries(tobari libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
SET_EXECUTABLE_TARGET_PROPERTIES(tobari)

COPY_FILES(tobari "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
COPY_FILES(tobari "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")

file(GLOB_RECURSE TOBARI_UI_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/ui/*")

add_custom_target(tobari_ui ALL
  COMMAND ${CMAKE_COMMAND} -E rm -rf "${CEF_TARGET_OUT_DIR}/ui"
  COMMAND ${CMAKE_COMMAND} -E copy_directory
          "${CMAKE_CURRENT_SOURCE_DIR}/ui" "${CEF_TARGET_OUT_DIR}/ui"
  DEPENDS ${TOBARI_UI_FILES}
  COMMENT "Syncing Tobari UI resources")

add_dependencies(tobari tobari_ui)
