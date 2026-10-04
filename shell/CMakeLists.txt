cmake_minimum_required(VERSION 3.21)
project(tobari C CXX)
if(APPLE)
  enable_language(OBJC OBJCXX)
endif()

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

# CEF links with -rpath,. — relative to the working directory, not the binary —
# and CMake adds the absolute path of the CEF tree it built against. Together
# they made the binary work only when launched from its own directory or on the
# machine that built it. Resolve libraries next to the executable instead.
list(REMOVE_ITEM CEF_LINKER_FLAGS "-Wl,-rpath,.")

if(OS_LINUX)
  # On macOS the framework is loaded at run time by CefScopedLibraryLoader.
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
endif()

add_subdirectory("${CEF_ROOT}/libcef_dll" libcef_dll_wrapper)

set(CEF_TARGET_OUT_DIR "${CMAKE_CURRENT_BINARY_DIR}")

find_program(CARGO_EXECUTABLE cargo REQUIRED)

set(BLOCKER_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../blocker")
set(BLOCKER_LIB "${BLOCKER_DIR}/target/release/libtobari_blocker.a")

if(NOT DEFINED TOBARI_CARGO_HOME)
  set(TOBARI_CARGO_HOME "${CMAKE_BINARY_DIR}/cargo-home")
endif()

add_custom_command(
  OUTPUT "${BLOCKER_LIB}"
  COMMAND ${CMAKE_COMMAND} -E env "CARGO_HOME=${TOBARI_CARGO_HOME}"
          ${CARGO_EXECUTABLE} build --release --locked
  WORKING_DIRECTORY "${BLOCKER_DIR}"
  DEPENDS "${BLOCKER_DIR}/src/lib.rs" "${BLOCKER_DIR}/Cargo.toml" "${BLOCKER_DIR}/Cargo.lock"
  COMMENT "Building tobari-blocker (adblock-rust)"
  VERBATIM)

add_custom_target(tobari_blocker_build DEPENDS "${BLOCKER_LIB}")

set(TOBARI_SRCS
  src/app.cc
  src/bangs.cc
  src/blocking.cc
  src/chrome_client.cc
  src/defaults.cc
  src/filters_update.cc
  src/onboarding.cc
  src/paths.cc
  src/schemes.cc
  src/shield.cc
  src/welcome_window.cc
)

# Version for tobari://about and the macOS bundle, from the newest release in
# the AppStream metainfo.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/../packaging/dev.tobari.Browser.metainfo.xml")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../packaging/dev.tobari.Browser.metainfo.xml" _metainfo)
string(REGEX MATCH "<release version=\"([^\"]+)\"" _release "${_metainfo}")
set(TOBARI_VERSION "${CMAKE_MATCH_1}")

if(OS_LINUX)
  add_executable(tobari src/main.cc ${TOBARI_SRCS})

  # Chromium's zygote changes the stack canary after fork(). main() is the only
  # Tobari frame live across that fork, so with a stack protector every forked
  # subprocess fails its canary check when it returns through main() and aborts
  # with "stack smashing detected". The rest of the code keeps the protector.
  set_source_files_properties(src/main.cc PROPERTIES COMPILE_OPTIONS "-fno-stack-protector")
  target_include_directories(tobari PRIVATE "${CEF_ROOT}" "${CMAKE_CURRENT_SOURCE_DIR}/src" "${BLOCKER_DIR}")
  add_dependencies(tobari libcef_dll_wrapper tobari_blocker_build)
  target_link_libraries(tobari libcef_lib libcef_dll_wrapper "${BLOCKER_LIB}" ${CEF_STANDARD_LIBS})
  SET_EXECUTABLE_TARGET_PROPERTIES(tobari)
  set_target_properties(tobari PROPERTIES
    BUILD_WITH_INSTALL_RPATH TRUE
    INSTALL_RPATH "$ORIGIN")

  COPY_FILES(tobari "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
  COPY_FILES(tobari "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
  set(TOBARI_RESOURCES_OUT "${CEF_TARGET_OUT_DIR}")
endif()

if(OS_MAC)
  # Tobari.app with CEF's framework and the five helper apps CEF requires
  # (renderer, GPU, plugin, alerts and the plain helper) in Contents/Frameworks;
  # the bundled extensions and filter lists go in Contents/Resources.
  set(TOBARI_APP "${CEF_TARGET_OUT_DIR}/Tobari.app")
  configure_file("${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in" "${CMAKE_CURRENT_BINARY_DIR}/Info.plist" @ONLY)

  add_executable(tobari MACOSX_BUNDLE src/mac/main_mac.mm ${TOBARI_SRCS})
  SET_EXECUTABLE_TARGET_PROPERTIES(tobari)
  target_include_directories(tobari PRIVATE "${CEF_ROOT}" "${CMAKE_CURRENT_SOURCE_DIR}/src" "${BLOCKER_DIR}")
  add_dependencies(tobari libcef_dll_wrapper tobari_blocker_build)
  target_link_libraries(tobari libcef_dll_wrapper "${BLOCKER_LIB}" ${CEF_STANDARD_LIBS}
    "-framework Security" "-framework CoreFoundation" "-framework SystemConfiguration")
  set_target_properties(tobari PROPERTIES
    OUTPUT_NAME "Tobari"
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist")
  COPY_MAC_FRAMEWORK(tobari "${CEF_BINARY_DIR}" "${TOBARI_APP}")

  foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
    string(REPLACE ":" ";" _suffix_list ${_suffix_list})
    list(GET _suffix_list 0 _name_suffix)
    list(GET _suffix_list 1 _target_suffix)
    list(GET _suffix_list 2 _plist_suffix)
    set(_helper_target "tobari_helper${_target_suffix}")
    set(_helper_name "Tobari Helper${_name_suffix}")
    set(_helper_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" _plist)
    string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_name}" _plist "${_plist}")
    string(REPLACE "\${PRODUCT_NAME}" "${_helper_name}" _plist "${_plist}")
    string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist "${_plist}")
    string(REPLACE "@TOBARI_VERSION@" "${TOBARI_VERSION}" _plist "${_plist}")
    file(WRITE "${_helper_plist}" "${_plist}")

    add_executable(${_helper_target} MACOSX_BUNDLE src/mac/helper_mac.cc src/schemes.cc)
    SET_EXECUTABLE_TARGET_PROPERTIES(${_helper_target})
    target_include_directories(${_helper_target} PRIVATE "${CEF_ROOT}" "${CMAKE_CURRENT_SOURCE_DIR}/src")
    add_dependencies(${_helper_target} libcef_dll_wrapper)
    target_link_libraries(${_helper_target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${_helper_target} PROPERTIES
      OUTPUT_NAME "${_helper_name}"
      MACOSX_BUNDLE_INFO_PLIST "${_helper_plist}")
    add_dependencies(tobari "${_helper_target}")
    add_custom_command(TARGET tobari POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
              "${CEF_TARGET_OUT_DIR}/${_helper_name}.app"
              "${TOBARI_APP}/Contents/Frameworks/${_helper_name}.app"
      VERBATIM)
  endforeach()

  # App icon, from the same master as the Linux icons.
  set(_iconset "${CMAKE_CURRENT_BINARY_DIR}/Tobari.iconset")
  add_custom_command(TARGET tobari POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${_iconset}"
    COMMAND sips -z 16 16 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_16x16.png"
    COMMAND sips -z 32 32 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_16x16@2x.png"
    COMMAND sips -z 32 32 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_32x32.png"
    COMMAND sips -z 64 64 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_32x32@2x.png"
    COMMAND sips -z 128 128 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_128x128.png"
    COMMAND sips -z 256 256 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_128x128@2x.png"
    COMMAND sips -z 256 256 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_256x256.png"
    COMMAND sips -z 512 512 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_256x256@2x.png"
    COMMAND sips -z 512 512 "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" --out "${_iconset}/icon_512x512.png"
    COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-1024.png" "${_iconset}/icon_512x512@2x.png"
    COMMAND iconutil -c icns "${_iconset}" -o "${TOBARI_APP}/Contents/Resources/Tobari.icns"
    VERBATIM)
  set(TOBARI_RESOURCES_OUT "${TOBARI_APP}/Contents/Resources")
endif()

set(EXT_SRC "${CMAKE_CURRENT_SOURCE_DIR}/extensions")
set(EXT_OUT "${TOBARI_RESOURCES_OUT}/extensions")
set(PAGES_OUT "${TOBARI_RESOURCES_OUT}/pages")
file(GLOB_RECURSE PAGES_DEPS CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/pages/*")
set(UI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/ui")
set(NEWTAB_UI_FILES newtab.html newtab.css newtab.js tokens.css motion.js prefs.js bangs.js bangs.json)
file(GLOB_RECURSE EXT_DEPS CONFIGURE_DEPENDS "${EXT_SRC}/*")

set(NEWTAB_COPY_UI "")
foreach(f ${NEWTAB_UI_FILES})
  list(APPEND NEWTAB_COPY_UI COMMAND ${CMAKE_COMMAND} -E copy "${UI_DIR}/${f}" "${EXT_OUT}/newtab/${f}")
endforeach()

add_custom_target(tobari_bundled_extensions ALL
  COMMAND ${CMAKE_COMMAND} -E rm -rf "${EXT_OUT}"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${EXT_SRC}" "${EXT_OUT}"
  COMMAND ${CMAKE_COMMAND} -E rm -f "${EXT_OUT}/newtab/.extension-id" "${EXT_OUT}/shield/.extension-id"
  ${NEWTAB_COPY_UI}
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${UI_DIR}/fonts" "${EXT_OUT}/newtab/fonts"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${UI_DIR}/vendor" "${EXT_OUT}/newtab/vendor"
  COMMAND ${CMAKE_COMMAND} -E copy "${UI_DIR}/tokens.css" "${EXT_OUT}/shield/tokens.css"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${UI_DIR}/fonts" "${EXT_OUT}/shield/fonts"
  # tobari:// pages: their own files plus the shared tokens, fonts, bang
  # table and the app icon.
  COMMAND ${CMAKE_COMMAND} -E rm -rf "${PAGES_OUT}"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/pages" "${PAGES_OUT}"
  COMMAND ${CMAKE_COMMAND} -E copy "${UI_DIR}/tokens.css" "${UI_DIR}/bangs.json" "${PAGES_OUT}/"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${UI_DIR}/fonts" "${PAGES_OUT}/fonts"
  COMMAND ${CMAKE_COMMAND} -E copy "${CMAKE_CURRENT_SOURCE_DIR}/icons/tobari-128.png" "${PAGES_OUT}/tobari.png"
  DEPENDS ${EXT_DEPS} ${TOBARI_UI_FILES} ${PAGES_DEPS}
  COMMENT "Staging bundled extensions")

add_dependencies(tobari tobari_bundled_extensions)
target_compile_definitions(tobari PRIVATE "TOBARI_VERSION=\"${TOBARI_VERSION}\"")

file(GLOB TOBARI_FILTER_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/filters/*.txt")

add_custom_target(tobari_filters ALL
  COMMAND ${CMAKE_COMMAND} -E make_directory "${TOBARI_RESOURCES_OUT}/filters"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different ${TOBARI_FILTER_FILES} "${CMAKE_CURRENT_SOURCE_DIR}/filters/SNAPSHOT" "${TOBARI_RESOURCES_OUT}/filters"
  DEPENDS ${TOBARI_FILTER_FILES}
  COMMENT "Staging filter lists")

add_dependencies(tobari tobari_filters)
