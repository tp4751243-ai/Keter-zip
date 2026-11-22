cmake_minimum_required(VERSION 3.20)
project(KeterTypesetterCore VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable compiler warnings
if(MSVC)
    add_compile_options(/W4 /utf-8 /permissive-)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Dependencies
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets PrintSupport)
find_package(PkgConfig REQUIRED)

pkg_check_modules(HARFBUZZ REQUIRED harfbuzz)
pkg_check_modules(ICU REQUIRED icu-uc icu-i18n)
pkg_check_modules(FREETYPE REQUIRED freetype2)

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${HARFBUZZ_INCLUDE_DIRS}
    ${ICU_INCLUDE_DIRS}
    ${FREETYPE_INCLUDE_DIRS}
)

# Core Typesetting Engine Library
add_library(keter_core STATIC
    src/core/shaper.cpp
    src/core/typography_engine.cpp
    src/core/font_manager.cpp
    src/core/nikud_handler.cpp
    src/core/typesetter.cpp
    src/core/document_model.cpp
    src/core/docx_importer.cpp
    src/core/knee_calculator.cpp
)

target_link_libraries(keter_core PUBLIC
    Qt6::Core
    Qt6::Gui
    ${HARFBUZZ_LIBRARIES}
    ${ICU_LIBRARIES}
    ${FREETYPE_LIBRARIES}
)

# Desktop Qt 6 Application
add_executable(keter_typesetter
    src/main.cpp
    src/ui/main_window.cpp
    src/ui/page_renderer_widget.cpp
    src/ui/font_inspector_dialog.cpp
)

target_link_libraries(keter_typesetter PRIVATE
    keter_core
    Qt6::Widgets
    Qt6::PrintSupport
)

# Automated Unit Tests
enable_testing()

add_executable(test_shaping tests/test_shaping.cpp)
target_link_libraries(test_shaping PRIVATE keter_core Qt6::Test)
add_test(NAME TestHarfBuzzShaping COMMAND test_shaping)

add_executable(test_nikud tests/test_nikud.cpp)
target_link_libraries(test_nikud PRIVATE keter_core Qt6::Test)
add_test(NAME TestNikudTaamim COMMAND test_nikud)

add_executable(test_glyph_metrics tests/test_glyph_metrics.cpp)
target_link_libraries(test_glyph_metrics PRIVATE keter_core Qt6::Test)
add_test(NAME TestGlyphMetrics COMMAND test_glyph_metrics)

add_executable(test_document_model tests/test_document_model.cpp)
target_link_libraries(test_document_model PRIVATE keter_core Qt6::Test)
add_test(NAME TestDocumentModel COMMAND test_document_model)

add_executable(test_docx_importer tests/test_docx_importer.cpp)
target_link_libraries(test_docx_importer PRIVATE keter_core Qt6::Test)
add_test(NAME TestDocxImporter COMMAND test_docx_importer)

add_executable(test_icu_bidi tests/test_icu_bidi.cpp)
target_link_libraries(test_icu_bidi PRIVATE keter_core Qt6::Test)
add_test(NAME TestIcuBidi COMMAND test_icu_bidi)
